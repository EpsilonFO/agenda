/**
 * La CONFIG DE VIE — source de vérité unique du planificateur v2.
 *
 * Toute règle métier chiffrée (quotas, horaires, clusters, trajets) vit dans
 * data/life-config.json, validé ici par zod. Plus JAMAIS de règle en dur dans
 * un prompt : les system prompts des agents seront générés depuis cet objet
 * (PLAN.md, phase 3) et les guardrails le liront (phase 2).
 *
 * Le fichier JSON doit rester lisible et éditable à la main : il se relit
 * comme THEME.md.
 */

import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";

/* --------------------------- Briques de base ------------------------- */

/** HH:MM 24h ("08:00", "21:30"). */
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "format HH:MM attendu");

export const TransportModeSchema = z.enum(["voiture", "velo", "transports", "a-pied"]);
export type TransportMode = z.infer<typeof TransportModeSchema>;

export const WeekdaySchema = z.enum([
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
  "dimanche",
]);
export type Weekday = z.infer<typeof WeekdaySchema>;

/** Date "YYYY-MM-DD". */
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "format YYYY-MM-DD attendu");

/* ------------------------- Clusters & lieux -------------------------- */

/**
 * Un cluster = une zone géographique où les trajets internes sont courts et
 * uniformes (ex: tout le plateau d'Orsay à ≤15 min en vélo/voiture).
 * Le planning raisonne d'abord en « base du jour » : dans quel cluster
 * vit la journée.
 */
const ClusterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Trajet forfaitaire entre deux lieux du même cluster, en minutes. */
  intraTravelMin: z.number().int().min(0),
  note: z.string().optional(),
});

const PlaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** id du cluster d'appartenance. */
  cluster: z.string().min(1),
  /** Modes interdits pour s'y rendre (ex: Delos inaccessible en voiture). */
  forbiddenModes: z.array(TransportModeSchema).default([]),
  /** true si on peut y dormir (point de chute). */
  sleepable: z.boolean().default(false),
  note: z.string().optional(),
});

/** Trajet entre deux clusters, par mode (seuls les modes pertinents sont listés). */
const InterClusterTravelSchema = z.object({
  between: z.tuple([z.string(), z.string()]),
  minutesByMode: z.partialRecord(TransportModeSchema, z.number().int().min(0)),
});

/* --------------------------- Règles horaires ------------------------- */

const ScheduleRulesSchema = z.object({
  /** Aucune activité ne commence avant cette heure. */
  dayStart: HHMM,
  /** Fin de journée NORMALE : rien ne se termine après, sauf exceptionnel. */
  normalEnd: HHMM,
  /** Fin absolue des sessions marquées « exceptionnelles » (échéance, semaine dense). */
  exceptionalEnd: HHMM,
  /** Nombre max de sessions exceptionnelles (finissant après normalEnd) par semaine. */
  maxExceptionalPerWeek: z.number().int().min(0),
  /** Trou max toléré ENTRE deux activités d'une journée, en minutes.
   *  (Les bornes de la journée restent libres : commencer à 11h ou finir à
   *  18h est sain — on ne remplit pas 8h→22h par principe.) */
  maxHoleMinutes: z.number().int().min(0),
  /** Battement minimal entre DEUX activités, même au même endroit : finir un
   *  cours à 17h45 puis enchaîner un bloc à 17h45 pile n'est pas humain
   *  (rangement, déplacement dans le bâtiment, souffle). Le trajet entre
   *  lieux, quand il est dû, est plus long et le couvre. */
  transitionMin: z.number().int().min(0).default(15),
  /** Pause déjeuner à préserver chaque jour dans la fenêtre donnée.
   *  Le dîner, lui, est flexible (peut être après normalEnd). */
  lunchBreak: z.object({
    minMinutes: z.number().int().min(0),
    idealMinutes: z.number().int().min(0),
  }),
  /** Règles spécifiques au week-end (samedi + dimanche). */
  weekend: z
    .object({
      /** Rien ne commence avant cette heure le week-end. */
      dayStart: HHMM,
      /** Privilégier la semaine : le week-end reste léger, Monumia n'y
       *  déborde que si le plancher n'est pas atteignable en semaine. */
      keepLight: z.boolean(),
    })
    .default({ dayStart: "10:00", keepLight: true }),
  /** Heure cible du trajet « veille au soir » (changement de zone pour le
   *  lendemain matin). Tardif pour éviter l'heure de pointe : après le dîner. */
  eveningTravelStart: HHMM.default("22:00"),
  note: z.string().optional(),
});

/* ------------------------------ Travail ------------------------------ */

const WorkSchema = z.object({
  /** Durée minimale d'un bloc de travail (delos/monumia) : en dessous, un
   *  bloc ne vaut pas le coût de s'y mettre — mieux vaut du temps libre. */
  minBlockMinutes: z.number().int().min(0).default(90),
  /** Les cours : événements fixes dans l'agenda, info indicative pour les agents. */
  cours: z.object({
    hoursPerWeek: z.number().min(0),
    placeId: z.string(),
    note: z.string().optional(),
  }),
  /** Imprévus / TP à échéance : posés tôt, jamais au pied du mur. */
  imprevus: z
    .object({
      /** Dernier jour de pose acceptable : deadline MOINS ce nombre de jours
       *  (1 = fini la veille au plus tard, jamais le jour J). */
      marginDaysMin: z.number().int().min(0).default(1),
      /** Marge visée quand la semaine le permet (3-4 jours de confort). */
      marginDaysIdeal: z.number().int().min(0).default(3),
      /** Heures réservées à un imprévu quand la demande n'en précise pas. */
      defaultHours: z.number().positive().default(2),
    })
    .default({ marginDaysMin: 1, marginDaysIdeal: 3, defaultHours: 2 }),
  /**
   * Le CDD Delos, en deux parts :
   *  - du PRÉSENTIEL sur place (Paris), posé sur les gabarits de demi-journée ;
   *  - des heures À DISTANCE, horaires libres comme n'importe quel bloc de
   *    travail, découpées par le solveur selon ce qui rentre sans trajet en plus.
   */
  delos: z.object({
    /** Demi-journées de présentiel sur place (Paris). */
    presentielHalfDaysPerWeek: z.number().int().min(0),
    placeId: z.string(),
    /** Gabarits de demi-journée que le planificateur peut poser. */
    halfDayWindows: z.array(z.object({ start: HHMM, end: HHMM })).min(1),
    /**
     * Regrouper les demi-journées sur UNE journée Paris quand c'est possible
     * (un seul aller-retour). Les étaler reste permis si la semaine l'impose.
     * Surchargeable à la semaine (overrides.delosGroupHalfDays).
     */
    groupHalfDays: z.boolean().default(true),
    /**
     * false (défaut) : Delos jamais le week-end. true : le week-end devient un
     * dernier recours quand la semaine ne suffit pas. Surchargeable à la
     * semaine (overrides.delosWeekendOk) — le QUOTA, lui, ne bouge jamais.
     */
    weekendOk: z.boolean().default(false),
    /** Les heures hors présentiel. Absent = tout le quota est en présentiel. */
    remote: z
      .object({
        hoursPerWeek: z.number().min(0),
        /** Où elles se posent par défaut (hors Paris). */
        placeId: z.string(),
        /**
         * Découpages autorisés, en heures, du plus simple au plus fractionné.
         * Le solveur prend le premier qui rentre.
         */
        blockHours: z.array(z.number().positive()).min(1).default([4, 2]),
      })
      .optional(),
    presentiel: z.enum(["obligatoire", "prefere", "indifferent"]),
    note: z.string().optional(),
  }),
  /** La startup Monumia : plancher d'heures + objectif de maximisation. */
  monumia: z.object({
    minHoursPerWeek: z.number().min(0),
    /** true = remplir les creux valides au-delà du plancher. */
    maximize: z.boolean(),
    /** Heures max par jour sur Monumia (garde-fou humain). */
    maxHoursPerDay: z.number().min(0),
    /** Plafond hebdomadaire — « maximiser » ne veut pas dire 36h/semaine. */
    maxHoursPerWeek: z.number().min(0).default(30),
    /** Heures max de Monumia PAR JOUR de week-end (0 = week-end interdit).
     *  Monumia est le travail le plus déplaçable : une demi-journée le
     *  week-end est une soupape normale, pas un échec. */
    weekendMaxHoursPerDay: z.number().min(0).default(4),
    /** Seuil de CONFORT en semaine : au-delà de ce volume quotidien, on
     *  préfère déborder sur le week-end plutôt que densifier les journées.
     *  (Le plafond dur reste maxHoursPerDay, atteint en dernier recours.) */
    weekdayComfortHoursPerDay: z.number().min(0).default(6),
    preferredPlaceIds: z.array(z.string()),
    note: z.string().optional(),
  }),
});

/* ------------------------------- Sport ------------------------------- */

const SportActivitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /**
   * voulu    = proposé par défaut chaque semaine ;
   * impose   = doit toujours figurer au planning ;
   * optionnel = jamais placé par défaut, seulement sur demande explicite.
   */
  status: z.enum(["voulu", "impose", "optionnel"]),
  /** Séances visées par semaine pour cette activité (rotation du solveur).
   *  Ignoré pour « optionnel » ; les quotas globaux min/max priment. */
  perWeek: z.number().int().min(0).max(7).default(1),
  /** Lieux possibles ; vide = n'importe où (ex: course à pied). */
  placeIds: z.array(z.string()).default([]),
  durationMin: z.number().int().min(10),
  intensity: z.enum(["low", "moderate", "high"]),
  /** Repos minimal après cette séance, en heures. */
  minRestHours: z.number().min(0),
  /** true si la séance peut se faire le matin dès dayStart. */
  morningOk: z.boolean().default(false),
  /** Créneau imposé (ex: natation avec la fac). null = libre. */
  fixedSlot: z
    .object({ weekday: WeekdaySchema, start: HHMM, end: HHMM })
    .nullable()
    .default(null),
  /** Heures d'ouverture du lieu, appliquées chaque jour. null = pas de contrainte. */
  openingHours: z.object({ open: HHMM, close: HHMM }).nullable().default(null),
  note: z.string().optional(),
});

const SportSchema = z.object({
  sessionsPerWeekMin: z.number().int().min(0),
  sessionsPerWeekMax: z.number().int().min(0),
  /** Tampon après une séance (douche, se changer) avant l'activité suivante. */
  bufferAfterMin: z.number().int().min(0).default(15),
  activities: z.array(SportActivitySchema),
});

/* ------------------------------ Sorties ------------------------------ */

const SortiesSchema = z.object({
  copine: z.object({
    name: z.string(),
    /** Objectif de sorties par semaine — un RAPPEL, pas une fabrication. */
    perWeekMin: z.number().int().min(0),
    /** true = le Conseil invente des sorties pour atteindre l'objectif.
     *  false (défaut) = seules les sorties demandées sont placées ; s'il en
     *  manque, on le signale (warning), on n'impose rien. */
    autoPlace: z.boolean().default(false),
    usualCluster: z.string(),
    note: z.string().optional(),
  }),
  amis: z.object({
    /** true = uniquement quand une sortie est demandée dans la semaine. */
    onRequestOnly: z.boolean(),
    usualCluster: z.string(),
    note: z.string().optional(),
  }),
});

/* ------------------------------ Cuisine ------------------------------ */

const CuisineSchema = z.object({
  budget: z.enum(["etudiant", "moyen", "large"]),
  /** Grosses portions (il mange beaucoup). */
  bigAppetite: z.boolean(),
  /** Adapter les plats aux séances de sport (récupération). */
  adaptToSport: z.boolean(),
  /** Aliments bannis : jamais dans une recette, même en option. */
  dislikedFoods: z.array(z.string()),
  /** Déjeuner au CROUS les jours avec cours le matin (pas de déjeuner maison). */
  lunchAtCrousIfMorningClass: z.boolean(),
  /** Aucun repas à prévoir les jours passés chez les parents. */
  noMealsAtParents: z.boolean(),
});

/* --------------------------- Solveur (v5) ---------------------------- */

/**
 * Réglages du moteur multi-candidats : le solveur génère `candidates` plans
 * complets (seeds dérivés de la semaine), la fonction objectif les score avec
 * ces poids, le meilleur gagne. Un poids à 0 éteint le terme. Les défauts
 * zod rendent toute la section optionnelle dans le JSON.
 */
const SolverSchema = z.object({
  /** Nombre de plans candidats générés puis départagés par le score. */
  candidates: z.number().int().min(1).max(50).default(8),
  objective: z
    .object({
      /** Pénalité par violation « warn » restante. */
      warn: z.number().default(20),
      /** Pénalité par heure de trou résiduel entre blocs travail/sport. */
      trouParHeure: z.number().default(4),
      /** Bonus par heure de Monumia au-dessus du plancher hebdo. */
      monumiaParHeure: z.number().default(3),
      /** Bonus par jour d'écart minimal entre deux séances de sport (cap 3). */
      sportEtalement: z.number().default(5),
      /** Bonus par jour sans travail ni sport (les cours fixes comptent comme travail). */
      jourOff: z.number().default(8),
      /** Pénalité par heure de travail posée samedi/dimanche. */
      weekendTravailParHeure: z.number().default(3),
      /** Pénalité par heure de travail/sport après finTardiveApres. */
      finTardiveParHeure: z.number().default(2),
      finTardiveApres: HHMM.default("19:00"),
      /** Pénalité par jour Delos présentiel au-delà du minimum regroupable. */
      delosJourParisSupplementaire: z.number().default(10),
    })
    // .prefault (pas .default) : zod 4 renvoie la valeur de .default TELLE
    // QUELLE sans la parser — ici on veut que {} passe par les défauts des champs.
    .prefault({}),
});

/* --------------------------- Config complète ------------------------- */

export const LifeConfigSchema = z
  .object({
    version: z.literal(1),
    clusters: z.array(ClusterSchema).min(1),
    places: z.array(PlaceSchema).min(1),
    interClusterTravel: z.array(InterClusterTravelSchema),
    /** Modes de transport possédés. */
    ownedModes: z.array(TransportModeSchema).min(1),
    schedule: ScheduleRulesSchema,
    work: WorkSchema,
    sport: SportSchema,
    sorties: SortiesSchema,
    cuisine: CuisineSchema,
    solver: SolverSchema.prefault({}),
  })
  .superRefine((cfg, issue) => {
    // Cohérence référentielle : tout id de cluster/lieu cité doit exister.
    const clusterIds = new Set(cfg.clusters.map((c) => c.id));
    const placeIds = new Set(cfg.places.map((p) => p.id));

    const checkCluster = (id: string, where: string) => {
      if (!clusterIds.has(id))
        issue.addIssue({ code: "custom", message: `cluster inconnu « ${id} » (${where})` });
    };
    const checkPlace = (id: string, where: string) => {
      if (!placeIds.has(id))
        issue.addIssue({ code: "custom", message: `lieu inconnu « ${id} » (${where})` });
    };

    cfg.places.forEach((p) => checkCluster(p.cluster, `places.${p.id}`));
    cfg.interClusterTravel.forEach((t, i) => {
      checkCluster(t.between[0], `interClusterTravel[${i}]`);
      checkCluster(t.between[1], `interClusterTravel[${i}]`);
    });
    checkPlace(cfg.work.cours.placeId, "work.cours");
    checkPlace(cfg.work.delos.placeId, "work.delos");
    cfg.work.monumia.preferredPlaceIds.forEach((id) => checkPlace(id, "work.monumia"));
    cfg.sport.activities.forEach((a) =>
      a.placeIds.forEach((id) => checkPlace(id, `sport.${a.id}`))
    );
    checkCluster(cfg.sorties.copine.usualCluster, "sorties.copine");
    checkCluster(cfg.sorties.amis.usualCluster, "sorties.amis");

    if (cfg.sport.sessionsPerWeekMax < cfg.sport.sessionsPerWeekMin)
      issue.addIssue({ code: "custom", message: "sport: max < min séances/semaine" });
  });

export type LifeConfig = z.infer<typeof LifeConfigSchema>;
export type Place = z.infer<typeof PlaceSchema>;
export type Cluster = z.infer<typeof ClusterSchema>;
export type SportActivity = z.infer<typeof SportActivitySchema>;

/* ------------------------------ Accès -------------------------------- */

const CONFIG_FILE = path.join(process.cwd(), "data", "life-config.json");

/** Charge et valide la config. Erreur lisible si le JSON est invalide. */
export async function loadLifeConfig(): Promise<LifeConfig> {
  const raw = await fs.readFile(CONFIG_FILE, "utf8");
  return parseLifeConfig(JSON.parse(raw));
}

/** Valide un objet config (utilisé par loadLifeConfig, les tests et l'API réglages). */
export function parseLifeConfig(data: unknown): LifeConfig {
  const result = LifeConfigSchema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `- ${i.path.join(".") || "(racine)"} : ${i.message}`)
      .join("\n");
    throw new Error(`life-config.json invalide :\n${details}`);
  }
  return result.data;
}

/** Écrit la config (après validation) — utilisé par la future page réglages. */
export async function saveLifeConfig(config: LifeConfig): Promise<void> {
  parseLifeConfig(config);
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
}

/* --------------------------- Helpers lecture ------------------------- */

/** Renvoie le lieu par id, ou undefined. */
export function placeById(cfg: LifeConfig, id?: string): Place | undefined {
  return id ? cfg.places.find((p) => p.id === id) : undefined;
}

/**
 * Minutes de trajet entre deux lieux selon la config :
 * même lieu → 0 ; même cluster → forfait intra ; sinon trajet inter-cluster.
 *
 * Un mode interdit à l'UN des deux bouts est exclu du trajet ENTIER : si on
 * ne peut pas ALLER à Delos en voiture, la voiture n'est pas sur place — on
 * ne peut pas non plus en REPARTIR en voiture.
 */
export function travelMinutes(
  cfg: LifeConfig,
  fromPlaceId: string,
  toPlaceId: string
): { minutes: number; mode: TransportMode } | null {
  if (fromPlaceId === toPlaceId) return { minutes: 0, mode: "a-pied" };
  const from = placeById(cfg, fromPlaceId);
  const to = placeById(cfg, toPlaceId);
  if (!from || !to) return null;

  const allowed = (mode: TransportMode) =>
    !from.forbiddenModes.includes(mode) && !to.forbiddenModes.includes(mode);

  if (from.cluster === to.cluster) {
    const cluster = cfg.clusters.find((c) => c.id === from.cluster);
    if (!cluster) return null;
    // Forfait intra-cluster ; le mode précis importe peu à cette échelle.
    const mode = cfg.ownedModes.find(allowed) || "a-pied";
    return { minutes: cluster.intraTravelMin, mode };
  }

  const entry = cfg.interClusterTravel.find(
    (t) =>
      (t.between[0] === from.cluster && t.between[1] === to.cluster) ||
      (t.between[0] === to.cluster && t.between[1] === from.cluster)
  );
  if (!entry) return null;

  let best: { minutes: number; mode: TransportMode } | null = null;
  for (const [mode, minutes] of Object.entries(entry.minutesByMode) as [
    TransportMode,
    number
  ][]) {
    if (!cfg.ownedModes.includes(mode)) continue;
    if (!allowed(mode)) continue;
    if (best === null || minutes < best.minutes) best = { minutes, mode };
  }
  return best;
}

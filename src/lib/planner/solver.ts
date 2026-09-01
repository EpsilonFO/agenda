/**
 * Le SOLVEUR déterministe — le cœur du planificateur v3.
 *
 * v2 laissait Josiane (LLM) faire le tetris et les guardrails la corrigeaient.
 * Résultat : du « légal mais idiot » à répétition (déjeuner de 30 min, salle en
 * plein samedi, Delos oublié) — parce que « idiot » n'est pas une règle qu'on
 * peut écrire, et qu'aucun modèle ne devine ce qu'on n'a pas encodé.
 *
 * v3 inverse : le CODE place, en phases déterministes, chaque pose validée en
 * direct contre les mêmes contraintes que les guardrails (overlap, trajet,
 * bornes). Ce qui rendait le solveur coûteux existe déjà : la config, le modèle
 * de trajets par clusters, travelMinutes(). Les défauts des runs LLM deviennent
 * STRUCTURELLEMENT impossibles :
 *   - déjeuner = un bloc `repas` de 60 min réservé avant tout remplissage ;
 *   - Delos posé sur les gabarits EXACTS (9-13 / 14-18) ;
 *   - salle jamais le week-end en pleine journée (règle de pose) ;
 *   - Monumia étalé en semaine, le week-end reste chill.
 *
 * La VARIÉTÉ (une feature voulue) est préservée par un RNG seedé (par défaut
 * sur weekStart) : quels jours deviennent des jours Paris, course le matin ou
 * le soir… varient d'une semaine à l'autre, mais restent reproductibles pour
 * un même seed. L'optimiseur v5 (optimize.ts) dérive K seeds et garde le
 * meilleur plan au score.
 *
 * v5 : plus aucun brief LLM. Le choix des sports vient de la rotation config
 * (perWeek par activité) surchargée par WeekInput.sport ; les imprévus et les
 * sorties viennent de la demande hebdo structurée (WeekInput). Le crochet
 * `decisions` survit comme entrée PURE (tests, pilotage) — plus aucun
 * producteur LLM.
 *
 * L'oracle final reste checkWeekPlan() : le solveur construit pour passer, les
 * tests le prouvent sur de nombreuses semaines. Zéro LLM ici.
 */

import { addDays, toLocalIso } from "../dates";
import type { LifeConfig, SportActivity } from "./config";
import { placeById, travelMinutes } from "./config";
import { checkWeekPlan, MIDDAY } from "./guardrails";
import type { WeekInput } from "./contracts";
import type { PlacementOptions, PlacementResult } from "./josiane";
import type { FixedItem, PlanSession, SessionCategory } from "./types";

/* ------------------------------ Helpers ----------------------------- */

const WEEKDAYS = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
] as const;

/** Les 7 dates (YYYY-MM-DD) de la semaine commençant à weekStart (lundi). */
function weekDates(weekStart: string): string[] {
  const monday = new Date(`${weekStart}T12:00:00`);
  return Array.from({ length: 7 }, (_, i) =>
    toLocalIso(addDays(monday, i)).slice(0, 10)
  );
}

/** "HH:MM" → minutes depuis minuit. */
function hhmm(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

/**
 * jour + minutes → ISO local "YYYY-MM-DDTHH:MM:00".
 *
 * Les minutes ≥ 1440 basculent sur le(s) jour(s) suivant(s). Sans ça, un trajet
 * de veille parti à 23:59 pour 70 min produisait "T25:09" : une date INVALIDE
 * (`new Date` → NaN), qui cassait le rendu du calendrier et faisait tourner en
 * rond le modèle de retouche à qui on l'affichait telle quelle.
 */
function iso(day: string, minutes: number): string {
  const dayShift = Math.floor(minutes / 1440);
  const rest = ((minutes % 1440) + 1440) % 1440;
  const d = dayShift === 0 ? day : addDaysIso(day, dayShift);
  const h = String(Math.floor(rest / 60)).padStart(2, "0");
  const m = String(rest % 60).padStart(2, "0");
  return `${d}T${h}:${m}:00`;
}

/** "YYYY-MM-DD" + n jours → "YYYY-MM-DD" (calcul en UTC, sans dérive de fuseau). */
function addDaysIso(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekdayIdx(day: string): number {
  return new Date(`${day}T12:00:00`).getDay();
}

function isWeekendDay(day: string): boolean {
  const d = weekdayIdx(day);
  return d === 0 || d === 6;
}

function labelOf(day: string): string {
  return `${WEEKDAYS[weekdayIdx(day)]} ${day}`;
}

/** Chevauchement en minutes entre deux intervalles. */
function overlap(aS: number, aE: number, bS: number, bE: number): number {
  return Math.max(0, Math.min(aE, bE) - Math.max(aS, bS));
}

/* ------------------------------- RNG --------------------------------- */

/** RNG seedé (mulberry32 + FNV-1a) : même seed → même suite. */
function makeRng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* --------------------------- Modèle interne -------------------------- */

/** Un intervalle occupé dans une journée (session posée ou événement fixe). */
type Occ = {
  start: number;
  end: number;
  placeId?: string;
  category: SessionCategory | "fixed";
  sessionId?: string;
};

/** L'état d'une journée pendant la construction. */
type Day = {
  date: string;
  idx: number; // 0..6 dans l'ordre de la semaine (lundi=0)
  weekend: boolean;
  dayStart: number;
  occ: Occ[];
  cluster: string; // cluster « de base » de la journée
};

/* ------------------------- Primitives de pose ------------------------ */

/**
 * true si poser [s,e] (lieu `place`, catégorie `cat`) entre en conflit avec
 * l'existant : dépassement de dayStart, chevauchement, ou trajet insuffisant
 * avec le voisin immédiat (avant/après). C'est la MÊME logique que
 * checkTravel/checkOverlaps/checkBounds — poser uniquement via cette fonction
 * garantit que ces guardrails ne lèveront jamais.
 */
function conflicts(
  cfg: LifeConfig,
  day: Day,
  s: number,
  e: number,
  place: string | undefined,
  cat: SessionCategory
): boolean {
  if (s < day.dayStart) return true;
  for (const o of day.occ) if (s < o.end && o.start < e) return true;

  const buffer = cfg.sport.bufferAfterMin;
  const transition = cfg.schedule.transitionMin;
  // Crédit déjeuner sur un battement de midi : seulement si AUCUN repas n'est
  // déjà posé ce jour-là — sinon on exigeait une 2e pause fantôme (1h de trou
  // entre deux blocs de l'après-midi alors qu'on avait déjà mangé).
  const lunch = day.occ.some((o) => o.category === "repas")
    ? 0
    : cfg.schedule.lunchBreak.minMinutes;

  // Voisin immédiat AVANT (le bloc dont la fin est la plus proche de s).
  const before = day.occ
    .filter((o) => o.end <= s)
    .sort((a, b) => b.end - a.end)[0];
  if (before) {
    let req = 0;
    // Trajet + déjeuner : seulement si les deux lieux sont connus et diffèrent.
    if (before.placeId && place && before.placeId !== place) {
      const t = travelMinutes(cfg, before.placeId, place);
      if (t) {
        req += t.minutes;
        if (overlap(before.end, s, MIDDAY.start, MIDDAY.end) > 0) req += lunch;
      }
    }
    // Douche/transition APRÈS une séance de sport : dûe quel que soit le lieu
    // (même la course en plein air, sans lieu, réclame ses 15 min).
    if (before.category === "sport") req += buffer;
    // Battement minimal entre deux activités, même au même endroit (un cours
    // qui finit à 17h45 n'enchaîne pas à 17h45 pile). Ni avant ni après un
    // repas : la pause EST la transition. Le trajet, plus long, la couvre.
    if (req < transition && before.category !== "repas" && cat !== "repas")
      req = transition;
    if (req > 0 && s - before.end < req) return true;
  }

  // Voisin immédiat APRÈS.
  const after = day.occ
    .filter((o) => o.start >= e)
    .sort((a, b) => a.start - b.start)[0];
  if (after) {
    let req = 0;
    if (after.placeId && place && after.placeId !== place) {
      const t = travelMinutes(cfg, place, after.placeId);
      if (t) {
        req += t.minutes;
        if (overlap(e, after.start, MIDDAY.start, MIDDAY.end) > 0) req += lunch;
      }
    }
    // On sort de NOTRE séance de sport → la suite doit laisser le buffer.
    if (cat === "sport") req += buffer;
    // Même battement minimal vers l'activité suivante.
    if (req < transition && after.category !== "repas" && cat !== "repas")
      req = transition;
    if (req > 0 && after.start - e < req) return true;
  }
  return false;
}

/**
 * Cherche le premier créneau libre de `dur` minutes pour (place, cat) dans
 * [lo, hi] (hi = fin AU PLUS TARD). Renvoie la minute de début, ou null.
 */
function findSlot(
  cfg: LifeConfig,
  day: Day,
  dur: number,
  place: string | undefined,
  cat: SessionCategory,
  lo: number,
  hi: number,
  fromEnd = false
): number | null {
  const start = Math.max(lo, day.dayStart);
  const cands: number[] = [];
  for (let s = start; s + dur <= hi; s += 15) cands.push(s);
  if (fromEnd) cands.reverse();
  for (const s of cands) if (!conflicts(cfg, day, s, s + dur, place, cat)) return s;
  return null;
}

/** Créneau libre au sens strict (chevauchement seul), pour le déjeuner sans lieu. */
function findFreeSlot(day: Day, dur: number, lo: number, hi: number): number | null {
  for (let s = Math.max(lo, day.dayStart); s + dur <= hi; s += 15) {
    if (!day.occ.some((o) => s < o.end && o.start < s + dur)) return s;
  }
  return null;
}

/* --------------------------- Décisions LLM --------------------------- */

/**
 * Les CHOIX QUALITATIFS de la semaine, que Josiane (LLM) tranche et que le
 * solveur exécute. C'est le seul espace où le modèle décide : quels jours
 * deviennent jours Paris, quel jour/moment pour chaque sport, quel soir pour
 * une sortie sans date. Tout le reste (déjeuner, équilibrage Monumia, trajets,
 * imprévus) reste mécanique. Chaque décision est VALIDÉE en direct par les
 * mêmes primitives que les guardrails ; une décision infaisable est rejetée
 * (avec sa raison) et le solveur retombe sur son heuristique seedée.
 */
export type DelosDecision = {
  /** Jour (YYYY-MM-DD) où poser du Delos. */
  date: string;
  /** journee = 2 gabarits (journée Paris) ; matin/apres-midi = un seul. */
  gabarit: "journee" | "matin" | "apres-midi";
};

export type SportDecision = {
  /** id d'activité de la config. */
  activityId: string;
  date: string;
  moment: "matin" | "fin-apres-midi";
};

export type SortieDecision = {
  /** label EXACT de la sortie demandée (input.sortiesDatees). */
  label: string;
  date: string;
  start?: string;
};

export type SolverDecisions = {
  delos?: DelosDecision[];
  sport?: SportDecision[];
  sorties?: SortieDecision[];
};

/** Une décision que le solveur n'a pas pu honorer, avec la raison (feedback LLM). */
export type RejectedDecision = {
  kind: "delos" | "sport" | "sortie";
  /** Référence lisible de la décision (date, label, ou activityId@date). */
  ref: string;
  reason: string;
};

/**
 * Génère les blocs de TRAJET inter-zones (Orsay ↔ Paris) pour l'affichage : on
 * scanne chaque journée (sessions posées + événements fixes), et entre deux
 * blocs consécutifs de clusters différents on insère un « trajet » calé pour
 * arriver juste à l'heure, avec le mode le plus rapide disponible (voiture si
 * elle est là, sinon transports). But : voir d'un coup d'œil quand prendre la
 * voiture. Les trajets INTRA-zone (≤ 15 min) ne sont pas matérialisés.
 */
function buildTravelEvents(cfg: LifeConfig, sessions: PlanSession[], fixed: FixedItem[]): PlanSession[] {
  const clusterOf = (placeId?: string) => (placeId ? placeById(cfg, placeId)?.cluster : undefined);
  const clusterName = (id: string) => cfg.clusters.find((c) => c.id === id)?.name ?? id;

  type Node = { start: number; end: number; placeId?: string };
  const byDay = new Map<string, Node[]>();
  const push = (day: string, n: Node) => {
    const list = byDay.get(day);
    if (list) list.push(n);
    else byDay.set(day, [n]);
  };
  for (const s of sessions) {
    push(s.start.slice(0, 10), { start: hhmm(s.start.slice(11, 16)), end: hhmm(s.end.slice(11, 16)), placeId: s.placeId });
  }
  for (const f of fixed) {
    push(f.start.slice(0, 10), { start: hhmm(f.start.slice(11, 16)), end: hhmm(f.end.slice(11, 16)), placeId: f.placeId });
  }

  const trajets: PlanSession[] = [];
  let seq = 0;
  const dates = [...byDay.keys()].sort();

  // Passe 1 — INTRA-JOUR : entre deux blocs consécutifs de clusters différents
  // le même jour, on matérialise le trajet (calé pour arriver juste à l'heure).
  for (const day of dates) {
    const sorted = byDay.get(day)!.sort((a, b) => a.start - b.start);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      const ca = clusterOf(a.placeId);
      const cb = clusterOf(b.placeId);
      if (!ca || !cb || ca === cb) continue; // seulement les trajets inter-zones
      const t = travelMinutes(cfg, a.placeId!, b.placeId!);
      if (!t || t.minutes <= 0) continue;
      const s = b.start - t.minutes;
      if (s < a.end) continue; // pas la place (ne devrait pas arriver : trajet déjà réservé)
      seq++;
      trajets.push({
        id: `sol-trajet-${seq}`,
        title: `Trajet ${clusterName(ca)} → ${clusterName(cb)} (${t.mode}, ${t.minutes} min)`,
        category: "trajet",
        start: iso(day, s),
        end: iso(day, b.start),
        rationale: "Déplacement entre deux zones.",
      });
    }
  }

  // Passe 2 — INTER-JOURS (veille au soir) : on compare le cluster où la
  // journée SE TERMINE RÉELLEMENT au premier bloc du lendemain. On suit la
  // position au fil des blocs (un bloc sans lieu hérite de la position en
  // cours) : cours à Orsay le matin puis soirée à Paris = on dort à Paris,
  // et le trajet Orsay→Paris a forcément eu lieu DANS la journée (passe 1) —
  // ne pas générer un trajet de veille fantôme depuis Orsay.
  // On vise une heure TARDIVE (eveningTravelStart, après le dîner) pour éviter
  // l'heure de pointe — MAIS jamais après le dernier bloc réel de la journée :
  // si la soirée finit à 23h59, le trajet a forcément eu lieu AVANT (on part de
  // là où on est). Sinon on afficherait un trajet impossible à 23h59+. */
  const eveningStart = hhmm(cfg.schedule.eveningTravelStart);
  const endPosition = new Map<string, { cluster: string; placeId: string; end: number }>();
  let carried: { cluster: string; placeId: string } | undefined; // position du matin, héritée de la veille
  for (const day of dates) {
    const sorted = byDay.get(day)!.slice().sort((a, b) => a.start - b.start);
    let pos = carried;
    let lastEnd = -1;
    for (const n of sorted) {
      const c = clusterOf(n.placeId);
      if (c) pos = { cluster: c, placeId: n.placeId! };
      if (n.end > lastEnd) lastEnd = n.end;
    }
    if (pos) endPosition.set(day, { ...pos, end: Math.max(lastEnd, 0) });
    carried = pos;
  }
  for (let d = 0; d + 1 < dates.length; d++) {
    const today = endPosition.get(dates[d]);
    const tomorrow = byDay
      .get(dates[d + 1])!.slice()
      .sort((a, b) => a.start - b.start);
    const first = tomorrow[0];
    if (!today || !first) continue;
    const cFirst = clusterOf(first.placeId);
    if (!cFirst || cFirst === today.cluster) continue;
    const t = travelMinutes(cfg, today.placeId, first.placeId!);
    if (!t || t.minutes <= 0) continue;
    const day = dates[d];
    // Dernier bloc RÉEL du jour (hors trajets déjà matérialisés) : le trajet
    // de veille ne peut pas partir après lui — on quitte le dernier endroit où
    // on se trouvait. S'il finit tard (soirée), on part aussitôt après ; sinon
    // on vise l'heure tardive habituelle, bornée par la fin de journée.
    const lastRealEnd = Math.max(
      ...byDay.get(day)!.map((n) => n.end),
      0
    );
    const start = Math.min(Math.max(today.end, eveningStart), Math.max(lastRealEnd, eveningStart));
    // Un trajet de VEILLE doit se terminer avant minuit. S'il déborde (soirée
    // jusqu'à 23h59), ce n'est plus un déplacement de la veille mais un retour
    // au petit matin : on dort sur place et le trajet se fera le lendemain.
    // Mieux vaut ne rien afficher qu'un départ impossible.
    if (start + t.minutes > 24 * 60) continue;
    seq++;
    trajets.push({
      id: `sol-trajet-${seq}`,
      title: `Trajet ${clusterName(today.cluster)} → ${clusterName(cFirst)} (${t.mode}, ${t.minutes} min, veille)`,
      category: "trajet",
      start: iso(day, start),
      end: iso(day, start + t.minutes),
      rationale: "Déplacement la veille pour être sur place le lendemain matin.",
    });
  }

  return trajets;
}

/* ----------------------------- Le solveur ---------------------------- */

export type SolveArgs = {
  input: WeekInput;
  fixed: FixedItem[];
  /** Choix qualitatifs imposés au solveur (tests, pilotage) — sinon tout est seedé au RNG. */
  decisions?: SolverDecisions;
  /** Seed du RNG (défaut : dérivé de weekStart). L'optimiseur en dérive K. */
  seed?: string;
};

/** Résultat du solveur : un PlacementResult + les décisions LLM rejetées. */
export type SolveResult = PlacementResult & { rejected: RejectedDecision[] };

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Construit la semaine de façon déterministe. `cfg` est déjà la config avec les
 * overrides hebdo appliqués (voir applyOverrides), `fixed` inclut déjà les
 * indisponibilités. `args.decisions` (optionnel) porte les choix qualitatifs de
 * Josiane : honorés s'ils sont faisables, rejetés (dans `rejected`) sinon, avec
 * repli sur l'heuristique seedée. Renvoie un SolveResult (attempts=0, pas de LLM).
 */
export function solveWeek(
  cfg: LifeConfig,
  args: SolveArgs,
  opts: PlacementOptions = {}
): SolveResult {
  const { input, fixed, decisions } = args;
  const rejected: RejectedDecision[] = [];
  const rng = makeRng(args.seed ?? `${input.weekStart}|v5`);
  const dates = weekDates(input.weekStart);
  const normalEnd = hhmm(cfg.schedule.normalEnd);
  const minBlock = cfg.work.minBlockMinutes;
  const notes: string[] = [];

  const emit = (kind: Parameters<NonNullable<PlacementOptions["onEvent"]>>[1], msg: string) =>
    opts.onEvent?.("solveur", kind, msg);

  // 1) Journées, amorcées avec les événements fixes.
  const days: Day[] = dates.map((date, idx) => {
    const weekend = isWeekendDay(date);
    const day: Day = {
      date,
      idx,
      weekend,
      dayStart: hhmm(weekend ? cfg.schedule.weekend.dayStart : cfg.schedule.dayStart),
      occ: [],
      cluster: "orsay",
    };
    for (const f of fixed) {
      if (f.start.slice(0, 10) !== date) continue;
      day.occ.push({
        start: hhmm(f.start.slice(11, 16)),
        end: hhmm(f.end.slice(11, 16)),
        placeId: f.placeId,
        category: "fixed",
      });
    }
    return day;
  });
  const dayByDate = new Map(days.map((d) => [d.date, d]));

  // Normalisation de label (comparaison insensible aux accents/casse).
  const normLabel = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .trim();

  // Monumia se pose UNIQUEMENT dans le cluster de la journée : pas de lieu de
  // travail parisien un jour Orsay et inversement. Sans lieu adapté → pas de
  // Monumia ce jour-là (évite un trajet inter-cluster fantôme masqué par le déj).
  const monPlace = (day: Day): string | null =>
    cfg.work.monumia.preferredPlaceIds.find(
      (p) => placeById(cfg, p)?.cluster === day.cluster
    ) ?? null;

  const out: PlanSession[] = [];
  let seq = 0;
  let monumiaWeekTotal = 0; // hebdo Monumia, suivi dès la phase 2 (imprévus exclus)
  const monumiaPerDay = new Map<string, number>();
  const add = (
    day: Day,
    cat: SessionCategory,
    s: number,
    e: number,
    fieldsOrPlace: { title: string; placeId?: string; activityId?: string; rationale?: string; exceptional?: boolean }
  ): PlanSession => {
    seq++;
    const sess: PlanSession = {
      id: `sol-${seq}-${cat}`,
      title: fieldsOrPlace.title,
      category: cat,
      activityId: fieldsOrPlace.activityId,
      placeId: fieldsOrPlace.placeId,
      start: iso(day.date, s),
      end: iso(day.date, e),
      exceptional: fieldsOrPlace.exceptional || undefined,
      rationale: fieldsOrPlace.rationale,
    };
    out.push(sess);
    day.occ.push({ start: s, end: e, placeId: fieldsOrPlace.placeId, category: cat, sessionId: sess.id });
    if (cat === "monumia") {
      monumiaWeekTotal += e - s;
      monumiaPerDay.set(day.date, (monumiaPerDay.get(day.date) ?? 0) + (e - s));
    }
    return sess;
  };

  /* ------------------------ Réservation du déjeuner --------------------- */

  const lunchIdeal = cfg.schedule.lunchBreak.idealMinutes;
  const lunchMin = cfg.schedule.lunchBreak.minMinutes;

  // Réserve un vrai déjeuner (idéalement 60 min) dans un créneau libre du midi.
  // Idempotent : un seul par jour. Appelé en 1re passe AVANT Delos distant et
  // le sport (sinon ils se collent « au plus tôt » après un cours et il ne
  // reste que 30 min pour manger), en 2e passe pour les jours devenus chargés,
  // et RAPPELÉ au premier bloc Monumia du jour.
  const reserveLunch = (day: Day): void => {
    if (day.occ.some((o) => o.category === "repas")) return;
    // 0) Collé à la FIN du bloc du matin (un cours qui finit à midi → on mange
    //    en sortant). Sans ça, le déjeuner s'ancrait « avant l'après-midi »
    //    (13h-14h avant un bloc de 14h) et laissait poireauter une heure.
    //    Après une séance de SPORT, le buffer douche reste dû avant de manger.
    const morningBlock = day.occ
      .filter((o) => o.category !== "sortie" && o.end >= 11 * 60 + 30 && o.end <= 13 * 60)
      .sort((a, b) => b.end - a.end)[0];
    if (morningBlock) {
      const s = morningBlock.end + (morningBlock.category === "sport" ? cfg.sport.bufferAfterMin : 0);
      const e = s + lunchIdeal;
      const free = !day.occ.some((o) => s < o.end && o.start < e);
      if (free && e <= 14 * 60 + 30) {
        add(day, "repas", s, e, {
          title: "Déjeuner",
          rationale: "Déjeuner en sortant du bloc du matin.",
        });
        return;
      }
    }
    // 1) Collé juste AVANT un bloc d'après-midi déjà posé (cours, Delos aprem) :
    //    le travail du matin peut alors enchaîner jusqu'au déjeuner sans trou.
    const anchor = day.occ
      .filter((o) => o.start >= 12 * 60 && o.start <= 14 * 60)
      .sort((a, b) => a.start - b.start)[0];
    if (anchor) {
      const s = anchor.start - lunchIdeal;
      const spanFree = s >= day.dayStart && !day.occ.some((o) => s < o.end && o.start < anchor.start);
      if (spanFree) {
        add(day, "repas", s, anchor.start, {
          title: "Déjeuner",
          rationale: "Déjeuner calé juste avant l'après-midi (pas de temps mort).",
        });
        return;
      }
    }
    // 2) Sinon : un vrai déjeuner dans le créneau de midi, au plus tôt.
    //    findSlot (et pas findFreeSlot) pour respecter les transitions : après
    //    une séance de sport, le déjeuner laisse le buffer douche (ex: salle à
    //    11h45 → déjeuner à 12h, pas 11h45 pile).
    let s = findSlot(cfg, day, lunchIdeal, undefined, "repas", 11 * 60 + 45, 14 * 60);
    let dur = lunchIdeal;
    if (s === null) {
      s = findSlot(cfg, day, lunchMin, undefined, "repas", MIDDAY.start, MIDDAY.end);
      dur = lunchMin;
    }
    if (s === null) return; // midi saturé (cours) : lunch-break signalera un warn
    add(day, "repas", s, s + dur, { title: "Déjeuner", rationale: "Pause déjeuner réservée." });
  };

  /* --------- 2) Imprévus / TP — la PRIORITÉ, avant sport et Monumia ------- */

  // Un TP à rendre passe AVANT Monumia et le sport : on le pose en premier,
  // tôt dans la semaine, et TOUJOURS avec de la marge — fini la veille de
  // l'échéance au plus tard (marginDaysMin), idéalement plusieurs jours avant.
  // Source de vérité : input.imprevus (la demande) ; sans volume précisé,
  // la config donne le défaut (work.imprevus.defaultHours).
  const monumiaDailyMax = cfg.work.monumia.maxHoursPerDay * 60;
  {
    for (const im of input.imprevus) {
      let remaining = Math.max(
        minBlock,
        Math.round((im.hoursNeeded ?? cfg.work.imprevus.defaultHours) * 60)
      );
      const deadline = im.deadline ?? dates[dates.length - 1];
      // Fenêtre de pose : jamais le jour J ni la veille (marge min) — la marge
      // idéale ordonne les jours candidats (tôt d'abord).
      const limit = dates.filter((d) => d <= deadline).at(-1);
      const margin = cfg.work.imprevus.marginDaysMin;
      const lastOk = toLocalIso(addDays(new Date(`${deadline}T12:00:00`), -margin)).slice(0, 10);
      let pool = days
        .filter((d) => d.date <= lastOk)
        .sort((a, b) => a.date.localeCompare(b.date));
      if (pool.length === 0 && limit) {
        pool = days.filter((d) => d.date <= limit);
        notes.push(
          `« ${im.label} » : marge de ${margin} j avant l'échéance impossible à tenir — posé au plus près quand même.`
        );
      }
      for (const d of pool) {
        if (remaining < minBlock) break;
        if ((monumiaPerDay.get(d.date) ?? 0) >= monumiaDailyMax) continue;
        const place = monPlace(d);
        if (!place) continue;
        const s = findSlot(cfg, d, minBlock, place, "autre", d.dayStart, normalEnd);
        if (s === null) continue;
        let e = s + minBlock;
        const cap = Math.min(normalEnd, s + remaining);
        while (e + 15 <= cap && !conflicts(cfg, d, s, e + 15, place, "autre")) e += 15;
        add(d, "autre", s, e, {
          title: im.label,
          placeId: place,
          rationale: `Imprévu/TP — pour le ${deadline}, posé tôt pour garder de la marge.`,
        });
        remaining -= e - s;
      }
      if (remaining >= minBlock) {
        notes.push(
          `« ${im.label} » : ${(remaining / 60).toFixed(1)}h n'ont pas pu être casées avant l'échéance.`
        );
      }
    }
  }

  /* --------- 3) Sorties DEMANDÉES (obligatoires, ne se négocient pas) ------ */

  const eveningDefaults = ["20:00", "23:00"];
  const weekdayEveningPref = [4, 5, 6, 3]; // vendredi, samedi, dimanche, jeudi (idx)
  const eveningFree = (d: Day) => !d.occ.some((o) => o.start < 23 * 60 && o.end > 20 * 60);

  // Lieu d'une sortie : on ne connaît pas le lieu exact, mais on connaît la ZONE
  // habituelle (Marine → Orsay, amis → Paris). Rattacher la sortie à un lieu
  // représentatif de cette zone suffit à faire respecter le trajet autour d'elle
  // (ex: dîner amis à Paris ⇒ temps de transport depuis Orsay imposé au travail
  // qui précède). Pour « autre », on INFÈRE la zone depuis le libellé (« …à
  // Paris », « …à Orsay ») puis depuis les notes de la demande ; sans indice,
  // la sortie reste sans lieu (zone inconnue, aucun trajet forcé).
  const clusterPlaceId = (cluster: string): string | undefined =>
    cfg.places.find((p) => p.cluster === cluster)?.id;
  // Mots-clés de zone, construits depuis la config (noms de clusters ET de
  // lieux : « Paris », « Orsay / Saclay », « Bibliothèque (Orsay) »…). Un mot
  // générique partagé par tous les clusters (« maison »…) n'est retenu que s'il
  // est distinctif (sinon on l'ignore : il ne discrimine rien).
  const clusterKeywords = cfg.clusters.map((c) => {
    const words = new Set<string>();
    const addWords = (text: string) => {
      for (const w of normLabel(text).split(/[^a-z]+/)) {
        if (w.length >= 4) words.add(w); // « paris », « orsay », « saclay »…
      }
    };
    addWords(c.name);
    for (const p of cfg.places.filter((p) => p.cluster === c.id)) addWords(p.name);
    return { cluster: c.id, words: [...words] };
  });
  const wordCount = new Map<string, number>();
  for (const { words } of clusterKeywords)
    for (const w of words) wordCount.set(w, (wordCount.get(w) ?? 0) + 1);
  const inferClusterFromText = (text: string): string | undefined => {
    if (!text) return undefined;
    const t = normLabel(text);
    for (const { cluster, words } of clusterKeywords) {
      if (words.some((w) => (wordCount.get(w) ?? 0) === 1 && t.includes(w))) return cluster;
    }
    return undefined;
  };
  const sortiePlaceId = (withWhom: string, label: string): string | undefined => {
    if (withWhom === "marine") return clusterPlaceId(cfg.sorties.copine.usualCluster);
    if (withWhom === "amis") return clusterPlaceId(cfg.sorties.amis.usualCluster);
    const inferred = inferClusterFromText(label) ?? inferClusterFromText(input.notes ?? "");
    return inferred ? clusterPlaceId(inferred) : undefined;
  };

  // Décisions de Josiane pour les sorties sans date imposée (par label).
  const sortieDecisions = new Map<string, SortieDecision>();
  for (const sd of decisions?.sorties ?? []) sortieDecisions.set(sd.label, sd);

  for (const r of input.sortiesDatees) {
    let day = r.day ? dayByDate.get(r.day) : undefined;
    const dec = !day ? sortieDecisions.get(r.label) : undefined;
    if (!day && dec) {
      // Jour choisi par Josiane : honoré si la soirée y est encore libre.
      const chosen = dayByDate.get(dec.date);
      if (chosen && eveningFree(chosen)) day = chosen;
      else
        rejected.push({
          kind: "sortie",
          ref: r.label,
          reason: chosen ? `soirée du ${dec.date} déjà occupée` : `jour ${dec.date} hors semaine`,
        });
    }
    if (!day) {
      // Sans jour : un soir de fin de semaine encore libre en soirée.
      for (const wi of weekdayEveningPref) {
        const d = days[wi];
        if (d && eveningFree(d)) {
          day = d;
          break;
        }
      }
      day = day ?? days[4];
    }
    const sMin = hhmm(r.start ?? dec?.start ?? eveningDefaults[0]);
    const eMin = r.end ? hhmm(r.end) : Math.min(sMin + 180, 23 * 60 + 59);
    const placeId = sortiePlaceId(r.withWhom, r.label);
    add(day, "sortie", sMin, eMin, {
      title: r.label,
      placeId,
      rationale: "Sortie demandée cette semaine.",
    });
    // Une soirée ancrée dans une AUTRE zone (ex : Tristan à Paris un jour
    // Orsay) bascule le cluster de la journée : le travail de fin de journée se
    // pose alors dans la zone de la soirée (Monumia à Paris), ce qui déclenche
    // le trajet dans la journée plutôt qu'un aller tardif. MAIS pas si le jour
    // est DÉJÀ ancré dans sa zone d'origine par un bloc fixe (cours, rdv) : un
    // cours à Orsay le matin + une soirée à Paris, c'est un trajet de fin de
    // journée Orsay → Paris, pas une journée « Paris » (sinon Monumia se pose à
    // Paris en pleine journée Orsay → ping-pong).
    const sc = placeId ? placeById(cfg, placeId)?.cluster : undefined;
    const anchoredInBase = day.occ.some(
      (o) => o.category === "fixed" && o.placeId && placeById(cfg, o.placeId)?.cluster === day.cluster
    );
    if (sc && sc !== day.cluster && sMin >= 17 * 60 && !anchoredInBase) day.cluster = sc;
  }

  /* --------------------- 3 bis) Demi-journées Delos --------------------- */

  const delosPlace = cfg.work.delos.placeId;
  const nHalf = cfg.work.delos.presentielHalfDaysPerWeek;
  const windows = cfg.work.delos.halfDayWindows.map((w) => ({
    s: hhmm(w.start),
    e: hhmm(w.end),
    label: `${w.start}-${w.end}`,
  }));
  const delosDates = new Set<string>();

  // Jours où un sport a un créneau IMPOSÉ (ex: natation le jeudi) : on évite d'y
  // poser Delos, sinon le sport (Orsay) et Delos (Paris) se disputent la journée.
  const fixedSportWeekdays = new Set(
    cfg.sport.activities
      .filter((a) => a.fixedSlot && a.status !== "optionnel")
      .map((a) => a.fixedSlot!.weekday)
  );

  if (nHalf > 0 && windows.length > 0) {
    let placed = 0;
    const usedDates = new Set<string>();

    // Pose une liste de gabarits sur un jour (chacun validé contre l'existant),
    // marque le jour « Paris ». Renvoie le nombre de demi-journées effectivement
    // posées (au plus maxN). Poser via conflicts() garantit qu'aucun guardrail
    // ne lèvera.
    const placeDelos = (
      day: Day,
      wins: { s: number; e: number }[],
      rationale: string,
      maxN = wins.length
    ): number => {
      let n = 0;
      for (const w of wins) {
        if (n >= maxN || placed + n >= nHalf) break;
        if (conflicts(cfg, day, w.s, w.e, delosPlace, "delos")) continue;
        add(day, "delos", w.s, w.e, { title: "Delos (présentiel)", placeId: delosPlace, rationale });
        n++;
      }
      if (n > 0) {
        day.cluster = "paris";
        delosDates.add(day.date);
        usedDates.add(day.date);
      }
      return n;
    };

    const winsFor = (gabarit: DelosDecision["gabarit"]): { s: number; e: number }[] => {
      if (gabarit === "journee") return windows.slice(0, 2);
      if (gabarit === "apres-midi" && windows[1]) return [windows[1]];
      return [windows[0]];
    };

    // 3a) Décisions de Josiane d'abord — un jour Paris peut désormais porter un
    // fixe compatible (validé par conflicts()), là où l'heuristique exigeait un
    // jour vierge.
    for (const d of decisions?.delos ?? []) {
      // Quota dépassé : on le DIT au lieu d'ignorer en silence — sinon la
      // demi-journée disparaît du plan sans que personne ne sache pourquoi.
      if (placed >= nHalf) {
        rejected.push({
          kind: "delos",
          ref: d.date,
          reason: `quota de ${nHalf} demi-journée(s) de présentiel déjà atteint`,
        });
        continue;
      }
      const day = dayByDate.get(d.date);
      if (!day) {
        rejected.push({ kind: "delos", ref: d.date, reason: "jour hors semaine" });
        continue;
      }
      if (day.weekend && !cfg.work.delos.weekendOk) {
        rejected.push({ kind: "delos", ref: d.date, reason: "Delos ne se pose pas le week-end" });
        continue;
      }
      if (usedDates.has(d.date)) continue;
      const n = placeDelos(day, winsFor(d.gabarit), "Demi-journée Delos (choix Josiane).");
      if (n === 0) {
        rejected.push({ kind: "delos", ref: d.date, reason: "créneau Delos en conflit (fixe/trajet)" });
      }
      placed += n;
    }

    // 3b) Complément seedé pour ce qui reste à poser. Tout jour où un gabarit
    // passe conflicts() est candidat — PAS seulement les jours vierges : une
    // semaine de cours tous les matins doit quand même recevoir ses
    // demi-journées (l'après-midi 14-18 passe très bien après un cours 9-12).
    // Vécu : l'ancien filtre « jour vierge » posait 0/2 en semaine de rentrée.
    if (placed < nHalf) {
      const weekendOk = cfg.work.delos.weekendOk;
      const candidates = shuffled(
        days.filter((d) => (!d.weekend || weekendOk) && !usedDates.has(d.date)),
        rng
      ).sort((a, b) => delosDayKey(a) - delosDayKey(b));
      // Par défaut on empile en journées COMPLÈTES (2 gabarits) : « 2 demi-journées
      // le même jour = journée Paris », donc un seul aller-retour. groupHalfDays
      // à false les étale sur des jours distincts (1 gabarit max par jour).
      let ci = 0;
      while (placed < nHalf && ci < candidates.length) {
        const day = candidates[ci++];
        const maxN = cfg.work.delos.groupHalfDays ? nHalf - placed : 1;
        placed += placeDelos(
          day,
          windows,
          maxN >= 2 ? "Demi-journée Delos (gabarit complet)." : "Demi-journée Delos.",
          maxN
        );
      }
    }

    // Ordre de préférence des jours du repli : semaine avant week-end (même
    // toléré, il reste un dernier recours), jours sans créneau sportif imposé,
    // puis jours vides (une journée Paris complète y tient sans découpage).
    function delosDayKey(d: Day): number {
      return (
        (d.weekend ? 100 : 0) +
        (fixedSportWeekdays.has(WEEKDAYS[weekdayIdx(d.date)]) ? 10 : 0) +
        (d.occ.length > 0 ? 1 : 0)
      );
    }

    if (placed < nHalf) {
      notes.push(
        `Seulement ${placed}/${nHalf} demi-journées Delos ont pu être posées (aucun gabarit ne passe sur les jours restants). À voir avec le reste de l'agenda.`
      );
      emit("info", `delos: ${placed}/${nHalf} posées`);
    }
  }

  /* ---------- Déjeuner (1re passe) : AVANT Delos distant et sport --------
   * Ces blocs se posent « au plus tôt » : sans réservation préalable, ils se
   * collent à 12h45 après un cours (trajet + crédit déjeuner) et il ne reste
   * que le fallback de 30 min pour manger. On fige d'abord un vrai déjeuner
   * sur les jours dont la matinée est occupée. */
  for (const day of days) {
    const busyMidday = day.occ.some(
      (o) => o.category !== "sortie" && o.start < 15 * 60 && o.end > day.dayStart
    );
    if (busyMidday) reserveLunch(day);
  }

  /* ------------------ 3 ter) Heures Delos à distance -------------------- */

  // Horaires libres (comme tout bloc de travail), hors Paris. Le découpage
  // n'est PAS choisi par un modèle : on essaie les gabarits déclarés du plus
  // simple au plus fractionné et on garde le premier qui rentre entièrement.
  const remoteCfg = cfg.work.delos.remote;
  if (remoteCfg && remoteCfg.hoursPerWeek > 0) {
    const totalMin = Math.round(remoteCfg.hoursPerWeek * 60);
    const remotePlace = remoteCfg.placeId;
    // Le week-end n'est candidat que si weekendOk (dernier recours).
    const weekdays = days.filter((d) => !d.weekend || cfg.work.delos.weekendOk);

    /** Ce découpage rentre-t-il en entier ? (simulation, sans rien poser) */
    const fits = (blockMin: number): boolean => {
      const count = totalMin / blockMin;
      if (!Number.isInteger(count) || count < 1) return false;
      const taken = new Set<string>();
      for (let i = 0; i < count; i++) {
        const day = weekdays.find(
          (d) =>
            !taken.has(d.date) &&
            findSlot(cfg, d, blockMin, remotePlace, "delos", d.dayStart, normalEnd) !== null
        );
        if (!day) return false;
        taken.add(day.date);
      }
      return true;
    };

    const blockMin =
      remoteCfg.blockHours.map((h) => Math.round(h * 60)).find(fits) ??
      Math.round(remoteCfg.blockHours[remoteCfg.blockHours.length - 1] * 60);

    let remoteDone = 0;
    const usedRemote = new Set<string>();
    while (remoteDone + blockMin <= totalMin) {
      let posed = false;
      for (const d of weekdays) {
        if (usedRemote.has(d.date)) continue;
        const s = findSlot(cfg, d, blockMin, remotePlace, "delos", d.dayStart, normalEnd);
        if (s === null) continue;
        add(d, "delos", s, s + blockMin, {
          title: "Delos (à distance)",
          placeId: remotePlace,
          rationale: `Heures Delos à distance (${blockMin / 60}h).`,
        });
        usedRemote.add(d.date);
        remoteDone += blockMin;
        posed = true;
        break;
      }
      if (!posed) break;
    }

    if (remoteDone < totalMin) {
      notes.push(
        `${(remoteDone / 60).toFixed(1)}h de Delos à distance posées sur ${(totalMin / 60).toFixed(1)}h attendues — pas assez de créneaux libres hors Paris.`
      );
      emit("info", `delos distant : ${remoteDone / 60}h/${totalMin / 60}h`);
    }
  }

  /* ---------------------------- 4) Sport ------------------------------- */

  const acts = cfg.sport.activities;
  const actById = new Map(acts.map((a) => [a.id, a]));

  // Liste désirée : ROTATION CONFIG (v5). Pour chaque activité, le nombre de
  // séances visées est : `fois` de input.sport.imposer si présent, sinon
  // perWeek (config). Les « impose » figurent toujours (au moins 1 fois,
  // exclusion hebdo ignorée) ; les « optionnel » ne se placent QUE via
  // imposer ; les « voulu » exclues cette semaine tombent à 0. On complète
  // ensuite au minimum hebdo avec les « voulu », plafonné au max.
  const excluded = new Set(input.sport.exclure);
  for (const id of input.sport.exclure) {
    if (!actById.has(id)) notes.push(`Sport à exclure « ${id} » inconnu de la config — ignoré.`);
  }
  const forcedCount = new Map<string, number>();
  for (const req of input.sport.imposer) {
    if (!actById.has(req.activityId)) {
      notes.push(`Sport demandé « ${req.activityId} » inconnu de la config — ignoré.`);
      continue;
    }
    forcedCount.set(req.activityId, (forcedCount.get(req.activityId) ?? 0) + req.fois);
  }
  const desiredCount = (a: SportActivity): number => {
    const forced = forcedCount.get(a.id) ?? 0;
    if (a.status === "impose") {
      if (excluded.has(a.id))
        notes.push(`${a.name} est imposée par la config — l'exclusion de la semaine est ignorée.`);
      return Math.max(a.perWeek, 1, forced);
    }
    if (a.status === "optionnel") return forced;
    if (excluded.has(a.id)) return 0;
    return forced > 0 ? forced : a.perWeek;
  };
  const desired: SportActivity[] = [];
  for (const a of acts) {
    for (let i = 0; i < desiredCount(a); i++) desired.push(a);
  }
  const voulu = acts.filter((a) => a.status === "voulu" && !excluded.has(a.id));
  let vi = 0;
  while (desired.length < cfg.sport.sessionsPerWeekMin && voulu.length > 0) {
    desired.push(voulu[vi % voulu.length]);
    vi++;
  }
  // Les activités à créneau IMPOSÉ (natation avec la fac) réservent leur slot
  // en premier : une séance flexible (salle) ne viendra pas le leur voler.
  const wantSport = desired
    .sort((a, b) => (a.fixedSlot ? 0 : 1) - (b.fixedSlot ? 0 : 1))
    .slice(0, cfg.sport.sessionsPerWeekMax);

  // Suivi de récupération (minutes absolues sur la semaine).
  const sportAbs: Array<{ actId: string; s: number; e: number }> = [];
  const restOk = (act: SportActivity, dayIdx: number, s: number, e: number): boolean => {
    const min = act.minRestHours * 60;
    const as = dayIdx * 1440 + s;
    const ae = dayIdx * 1440 + e;
    return sportAbs
      .filter((p) => p.actId === act.id)
      .every((p) => as - p.e >= min || p.s - ae >= min);
  };

  const clusterOfPlace = (id?: string) => (id ? placeById(cfg, id)?.cluster : undefined);

  const eligibleForSport = (act: SportActivity, day: Day): boolean => {
    // Le week-end reste léger : pas d'activité « à lieu » (salle/piscine), seule
    // la course (sans lieu, dehors) est tolérée le matin.
    if (day.weekend && act.placeIds.length > 0) return false;
    // Jour Paris : seules les activités praticables à Paris (ou sans lieu).
    if (delosDates.has(day.date) && act.placeIds.length > 0) {
      if (clusterOfPlace(act.placeIds[0]) !== "paris") return false;
    }
    return true;
  };

  // Décisions sport de Josiane, groupées par activité (file consommée dans
  // l'ordre : une décision par instance de séance désirée).
  const sportDecisionQueue = new Map<string, SportDecision[]>();
  for (const sd of decisions?.sport ?? []) {
    const q = sportDecisionQueue.get(sd.activityId) ?? [];
    q.push(sd);
    sportDecisionQueue.set(sd.activityId, q);
  }

  // Tente de poser une séance à un moment donné. « matin » = fenêtre du matin
  // (idéalement tôt, mais pour une activité à lieu un jour de cours, on accepte
  // la FIN DE MATINÉE — collée à la fin du dernier bloc du matin, le déjeuner
  // glisse après) ; « fin-apres-midi » ∈ [16:30,hi]. Renvoie true si posée.
  const placeSportAt = (
    act: SportActivity,
    d: Day,
    dur: number,
    place: string | undefined,
    moment: SportDecision["moment"],
    lo: number,
    hi: number
  ): boolean => {
    let s: number | null = null;
    if (moment === "matin") {
      // Une activité « pas le matin » (morningOk=false, ex: la salle) honorée en
      // « matin » ne démarre jamais au petit matin : on vise la fin de matinée.
      const matinLo = act.morningOk ? lo : Math.max(lo, 10 * 60 + 30);
      s = findSlot(cfg, d, dur, place, "sport", matinLo, Math.min(11 * 60 + 30, hi));
      // Activité à lieu un jour déjà occupé le matin (cours) : fin de matinée,
      // collée au dernier bloc du matin, pour ne pas couper l'après-midi. MAIS
      // seulement si ce dernier bloc finit TÔT (≤ 11h) : la séance démarre alors
      // ≤ 11h15 et finit avant 13h, déjeuner préservé. Collée à un cours qui
      // finit à midi, elle démarrerait à 12h15 et mangerait le déjeuner +
      // l'après-midi : c'est un jour chargé, on renonce (le caller tentera
      // « fin-apres-midi »).
      if (s === null && place) {
        const lastMorningEnd = Math.max(
          d.dayStart,
          ...d.occ.filter((o) => o.category !== "sortie" && o.start < 14 * 60).map((o) => o.end)
        );
        if (lastMorningEnd <= 11 * 60) {
          s = findSlot(cfg, d, dur, place, "sport", Math.max(lo, Math.max(10 * 60 + 30, lastMorningEnd)), Math.min(13 * 60, hi));
        }
      }
    } else {
      s = findSlot(cfg, d, dur, place, "sport", Math.max(lo, 16 * 60 + 30), hi);
    }
    if (s === null || !restOk(act, d.idx, s, s + dur)) return false;
    add(d, "sport", s, s + dur, { title: act.name, activityId: act.id, placeId: place, rationale: "Séance (choix Josiane)." });
    sportAbs.push({ actId: act.id, s: d.idx * 1440 + s, e: d.idx * 1440 + s + dur });
    return true;
  };

  for (const act of wantSport) {
    const dur = act.durationMin;
    const place = act.placeIds[0]; // undefined pour la course

    // Créneau imposé (ex: natation avec la fac) : jour + heure figés.
    if (act.fixedSlot) {
      const target = days.find((d) => WEEKDAYS[weekdayIdx(d.date)] === act.fixedSlot!.weekday);
      if (target) {
        const s = hhmm(act.fixedSlot.start);
        const e = hhmm(act.fixedSlot.end);
        if (!conflicts(cfg, target, s, e, place, "sport") && restOk(act, target.idx, s, e)) {
          add(target, "sport", s, e, { title: act.name, activityId: act.id, placeId: place, rationale: "Créneau imposé." });
          sportAbs.push({ actId: act.id, s: target.idx * 1440 + s, e: target.idx * 1440 + e });
        } else {
          notes.push(`${act.name} : créneau imposé (${act.fixedSlot.weekday} ${act.fixedSlot.start}) indisponible cette semaine.`);
        }
      }
      continue;
    }

    // Fenêtre praticable (heures d'ouverture ∩ bornes de journée).
    const open = act.openingHours ? hhmm(act.openingHours.open) : 0;
    const close = act.openingHours ? hhmm(act.openingHours.close) : normalEnd;

    // Décision de Josiane pour cette instance de séance : jour + moment choisis,
    // honorés si faisables ; sinon rejetée avec raison et repli sur le scoring.
    const dec = sportDecisionQueue.get(act.id)?.shift();
    if (dec) {
      const d = dayByDate.get(dec.date);
      if (!d) {
        rejected.push({ kind: "sport", ref: `${act.id}@${dec.date}`, reason: "jour hors semaine" });
      } else if (!eligibleForSport(act, d)) {
        rejected.push({ kind: "sport", ref: `${act.id}@${dec.date}`, reason: "jour non éligible (week-end ou jour Paris pour une activité hors Paris)" });
      } else if (dec.moment === "matin" && !act.morningOk && !place) {
        // « Pas le matin » ne vaut que pour une activité SANS lieu (course de
        // nuit…) : une activité à lieu peut honorer « matin » en FIN DE MATINÉE
        // (créneau creux, collé au dernier bloc du matin) — placeSportAt gère.
        rejected.push({ kind: "sport", ref: `${act.id}@${dec.date}`, reason: `${act.name} ne se pratique pas le matin` });
      } else {
        const lo = Math.max(open, d.dayStart);
        const hi = Math.min(close, normalEnd);
        if (placeSportAt(act, d, dur, place, dec.moment, lo, hi)) continue;
        rejected.push({ kind: "sport", ref: `${act.id}@${dec.date}`, reason: "aucun créneau libre au moment choisi (conflit ou récupération)" });
      }
    }

    // Jours éligibles, triés pour étaler : moins de sport d'abord, puis loin de
    // TOUTE séance déjà posée (même activité comptée double), tie-break seedé.
    // ⚠ dist doit rester FINIE : avec Infinity (aucune séance posée), toutes
    // les clés valaient -Infinity et le tri ne triait rien — le choix du jour
    // était le pur hasard du shuffle (vécu : 2 sports le même jour alors que
    // d'autres jours étaient vides).
    const lastSame = sportAbs.filter((p) => p.actId === act.id).map((p) => p.s);
    const allSport = sportAbs.map((p) => p.s);
    const distTo = (d: Day, points: number[]) =>
      points.length
        ? Math.min(...points.map((x) => Math.abs(d.idx * 1440 - x))) / 1440
        : 7; // aucune référence : distance neutre max (en jours)
    const scored = shuffled(days, rng)
      .filter((d) => eligibleForSport(act, d))
      .map((d) => {
        const sportCount = d.occ.filter((o) => o.category === "sport").length;
        // Étalement : loin des séances de la même activité (récup) ET des
        // autres séances (pas deux sports le même jour si évitable).
        const spread = distTo(d, lastSame) + distTo(d, allSport);
        // On privilégie la semaine (week-end pénalisé pour keepLight).
        return { d, key: sportCount * 1000 - spread + (d.weekend ? 1e6 : 0) };
      })
      .sort((a, b) => a.key - b.key);

    let done = false;
    for (const { d } of scored) {
      const lo = Math.max(open, d.dayStart);
      const hi = Math.min(close, normalEnd);
      // FIN DE MATINÉE (créneau creux, ≈ 10h30 ou juste après le dernier bloc du
      // matin) : idéale pour une activité à lieu (salle/piscine) — l'après-midi
      // reste libre pour un grand bloc de travail. MAIS seulement si le dernier
      // bloc du matin finit TÔT (≤ 11h) : la séance démarre ≤ 11h15 et finit
      // avant 13h, déjeuner préservé. Collée à un cours qui finit à midi, elle
      // démarrerait à 12h15 et mangerait le déjeuner + l'après-midi : c'est un
      // jour chargé, on passera directement à la fin d'après-midi.
      const lastMorningEnd = Math.max(
        d.dayStart,
        ...d.occ
          .filter((o) => o.category !== "sortie" && o.start < 14 * 60)
          .map((o) => o.end)
      );
      const lateMorningLo = Math.max(lo, Math.max(10 * 60 + 30, lastMorningEnd));
      let s: number | null = null;
      if (!act.morningOk && act.placeIds.length > 0 && lastMorningEnd <= 11 * 60) {
        s = findSlot(cfg, d, dur, place, "sport", lateMorningLo, Math.min(13 * 60, hi));
      }
      // Course/activités « matin ok » : le matin de préférence ; sinon
      // fin d'après-midi (surtout la salle : jamais en plein milieu de journée
      // un jour chargé, pour ne pas couper un bloc de travail).
      if (s === null && act.morningOk) {
        s = findSlot(cfg, d, dur, place, "sport", lo, Math.min(11 * 60 + 30, hi));
      }
      if (s === null) {
        // Fin d'après-midi, AU PLUS TÔT : la séance se colle juste après le
        // travail (pas de séance à 21h qui laisse un trou béant en soirée).
        const eveLo = act.morningOk ? lo : Math.max(lo, 16 * 60 + 30);
        s = findSlot(cfg, d, dur, place, "sport", eveLo, hi);
      }
      if (s === null && !act.morningOk) {
        s = findSlot(cfg, d, dur, place, "sport", lo, hi);
      }
      if (s === null) continue;
      if (!restOk(act, d.idx, s, s + dur)) continue;
      add(d, "sport", s, s + dur, { title: act.name, activityId: act.id, placeId: place, rationale: "Séance de la semaine." });
      sportAbs.push({ actId: act.id, s: d.idx * 1440 + s, e: d.idx * 1440 + s + dur });
      done = true;
      break;
    }
    if (!done) emit("info", `sport: impossible de caser ${act.name} cette semaine`);
  }

  /* -------------- 5) Déjeuner (2e passe, avant Monumia) ----------------- */

  // Les jours devenus chargés au midi depuis la 1re passe (sport posé sur le
  // créneau de midi) reçoivent leur déjeuner maintenant, avant le remplissage.
  for (const day of days) {
    const busyMidday = day.occ.some(
      (o) => o.category !== "sortie" && o.start < 15 * 60 && o.end > day.dayStart
    );
    if (busyMidday) reserveLunch(day);
  }

  /* --------------------------- 6) Monumia ------------------------------ */

  const mon = cfg.work.monumia;
  const dailyMax = mon.maxHoursPerDay * 60;
  const weekMax = mon.maxHoursPerWeek * 60;
  const weekMin = mon.minHoursPerWeek * 60;
  // Cible : plancher + 2h de marge (le pas de minBlock ne doit jamais nous
  // faire retomber SOUS le plancher), poussée au plafond si maximize.
  const target = clamp(
    mon.maximize ? weekMax : weekMin + 120,
    Math.min(weekMin + 120, weekMax),
    weekMax
  );
  const chunk = 240; // on pose par blocs ≤ 4h pour étaler la charge

  // Suivi hebdo/quotidien partagé avec la phase imprévus (monPlace, compteurs
  // initialisés plus haut — les blocs « autre » ne comptent pas dans Monumia).
  const perDay = monumiaPerDay;
  let weekTotal = monumiaWeekTotal;

  // Pose un bloc Monumia sur `day` (le plus tôt possible), renvoie les min posées.
  const addMonumiaBlock = (day: Day, maxDur: number): number => {
    if (maxDur < minBlock) return 0;
    const place = monPlace(day);
    if (!place) return 0;
    reserveLunch(day); // garantit un midi libre avant de remplir la journée
    const s = findSlot(cfg, day, minBlock, place, "monumia", day.dayStart, normalEnd);
    if (s === null) return 0;
    let e = s + minBlock;
    const cap = Math.min(normalEnd, s + maxDur);
    while (e + 15 <= cap && !conflicts(cfg, day, s, e + 15, place, "monumia")) e += 15;
    add(day, "monumia", s, e, { title: "Monumia", placeId: place, rationale: "Bloc de travail Monumia." });
    return e - s;
  };

  /* --------- 6b) Fusion des blocs Monumia adjacents ------------------------
   * Les phases 2 (imprévus) et 6 plafonnent chaque pose (chunk ≤ 4h, cap
   * horaire) : un même fil de Monumia au même endroit peut sortir en plusieurs
   * blocs séparés du seul battement de 15 min (13:00→17:00 puis 17:15→19:00).
   * Or le battement sert à CHANGER d'activité — pas à s'interrompre au même
   * endroit sur le même travail : on fusionne en un bloc continu (plafonné à
   * maxHoursPerDay/jour). Sans ça, le guardrail work-split lève une erreur.
   * À appeler APRÈS chaque phase de pose (imprévus, fills). */
  const mergeAdjacentMonumia = () => {
    const transition = cfg.schedule.transitionMin;
    const perDayCap = mon.maxHoursPerDay * 60;
    const minOf = (ts: string) => hhmm(ts.slice(11, 16));
    const removeBlock = (day: Day, sess: PlanSession) => {
      out.splice(out.indexOf(sess), 1);
      const oi = day.occ.findIndex((o) => o.sessionId === sess.id);
      if (oi >= 0) day.occ.splice(oi, 1);
    };
    for (const day of days) {
      const blocks = out
        .filter((s) => s.category === "monumia" && s.start.startsWith(day.date))
        .sort((a, b) => a.start.localeCompare(b.start));
      for (let i = 1; i < blocks.length; i++) {
        const prev = blocks[i - 1];
        const next = blocks[i];
        if (prev.placeId !== next.placeId) continue;
        const gap = minOf(next.start) - minOf(prev.end);
        if (gap < 0 || gap > transition) continue;
        const prevDur = minOf(prev.end) - minOf(prev.start);
        const nextDur = minOf(next.end) - minOf(next.start);
        // Plafond journalier : le bloc fusionné ne peut pas dépasser perDayCap
        // (les autres blocs du jour comptent aussi). On rogne la QUEUE du bloc
        // suivant (jamais le précédent, posé en premier = prioritaire) : seules
        // les minutes au-delà du plafond sautent — c'est exactement le trop-
        // plein produit par la passe 3 (weekdayComfort → dailyMax).
        const others = (perDay.get(day.date) ?? 0) - prevDur - nextDur;
        const merged = Math.min(prevDur + nextDur, Math.max(perDayCap - others, 0));
        if (merged <= 0) continue;
        const removed = prevDur + nextDur - merged;
        prev.end = iso(day.date, minOf(prev.start) + merged);
        const occPrev = day.occ.find((o) => o.sessionId === prev.id);
        if (occPrev) occPrev.end = minOf(prev.end);
        removeBlock(day, next);
        blocks.splice(i, 1);
        perDay.set(day.date, others + merged);
        weekTotal -= removed;
        i--; // le bloc fusionné peut être contigu au suivant
      }
    }
  };
  mergeAdjacentMonumia(); // fusionne déjà les blocs posés par la phase imprévus

  // Remplit un ensemble de jours en équilibrant (le jour le moins chargé
  // d'abord), jusqu'à `until` minutes hebdo, sans dépasser `cap`/jour.
  const fill = (pool: Day[], until: number, capPerDay: number) => {
    const stuck = new Set<string>();
    while (weekTotal < until) {
      let best: Day | null = null;
      let bestVal = Infinity;
      for (const d of pool) {
        if (stuck.has(d.date)) continue;
        const cur = perDay.get(d.date) ?? 0;
        if (cur >= capPerDay) continue;
        if (cur < bestVal) {
          bestVal = cur;
          best = d;
        }
      }
      if (!best) break;
      // Taille bornée par le plafond DUR (weekMax) et le plafond quotidien — pas
      // par la cible molle `until` : sinon le dernier bloc, rogné sous le bloc
      // minimal, serait rejeté et on resterait coincé sous le plancher.
      const room = Math.min(chunk, capPerDay - bestVal, weekMax - weekTotal);
      const placed = addMonumiaBlock(best, room);
      if (placed <= 0) {
        stuck.add(best.date);
        continue;
      }
      perDay.set(best.date, bestVal + placed);
      weekTotal += placed;
    }
  };

  const weekdayPool = days.filter((d) => !d.weekend);
  const weekendPool = days.filter((d) => d.weekend);

  // Monumia est le travail le plus DÉPLAÇABLE : la semaine porte l'essentiel,
  // puis une SOUPAPE week-end (plafonnée à weekendMaxHoursPerDay/jour) absorbe
  // ce qui rendrait les journées de semaine trop denses — avant de pousser la
  // semaine au plafond dur (maxHoursPerDay). keepLight = week-end réservé au
  // strict plancher non atteignable autrement.
  const weekendCap = Math.min(mon.weekendMaxHoursPerDay * 60, dailyMax);
  // Seuil « confort » en semaine (config) : au-delà, on préfère déborder sur
  // le week-end plutôt que densifier — des journées à 8h de Monumia après 3h
  // de cours, c'est légal mais invivable. Plancher weekMin/5 : le confort ne
  // descend jamais sous ce que la semaine seule doit pouvoir porter.
  const weekdayComfort = Math.min(
    dailyMax,
    Math.max(weekMin / 5, Math.round(mon.weekdayComfortHoursPerDay * 60))
  );
  if (weekendCap > 0 && !cfg.schedule.weekend.keepLight) {
    fill(weekdayPool, target, weekdayComfort);
    if (weekTotal < target) fill(weekendPool, target, weekendCap);
    if (weekTotal < target) fill(weekdayPool, target, dailyMax);
  } else {
    fill(weekdayPool, target, dailyMax);
  }
  if (weekTotal < weekMin) fill(weekendPool, weekMin, weekendCap);
  mergeAdjacentMonumia(); // fusionne les blocs fractionnés par les fills

  if (weekTotal < weekMin) {
    notes.push(
      `Monumia : seulement ${(weekTotal / 60).toFixed(1)}h ont pu être casées sur ${(weekMin / 60)}h minimum — semaine trop contrainte (cours, indisponibilités).`
    );
  }

  /* --------------------------- 8) Verdict ------------------------------ */

  out.sort((a, b) => a.start.localeCompare(b.start));
  const violations = checkWeekPlan(cfg, out, fixed, {
    requestedSorties: input.sortiesDatees,
    imprevus: input.imprevus,
  });
  emit(
    "violations",
    violations.filter((v) => v.severity === "error").map((v) => `- [${v.rule}] ${v.message}`).join("\n") ||
      "(aucune erreur)"
  );

  const warns = violations.filter((v) => v.severity === "warn").map((v) => v.message);
  const unresolved = violations
    .filter((v) => v.severity === "error")
    .map((v) => `Non résolu : ${v.message}`);

  // Trajets inter-zones : générés APRÈS le verdict (blocs d'affichage, non
  // soumis aux règles) puis fondus dans la sortie triée.
  const withTravel = [...out, ...buildTravelEvents(cfg, out, fixed)].sort((a, b) =>
    a.start.localeCompare(b.start)
  );

  return {
    sessions: withTravel,
    violations,
    warnings: [...notes, ...warns, ...unresolved],
    attempts: 0,
    rejected,
  };
}

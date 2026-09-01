/**
 * La FONCTION OBJECTIF (v5) — score déterministe d'un plan de semaine.
 *
 * Le solveur garantit la LÉGALITÉ (guardrails) ; l'objectif départage les
 * plans légaux entre eux : compacité, Monumia au-dessus du plancher, sport
 * étalé, jours off, week-end léger, fins de journée raisonnables, Delos
 * groupé, peu de trajets, charge totale contenue. L'optimiseur (optimize.ts)
 * génère les candidats (seeds × cibles Monumia) et garde le meilleur.
 *
 * 100 % pur : mêmes entrées → même score. Les poids vivent dans
 * cfg.solver.objective (life-config.json) ; un poids à 0 éteint son terme.
 * Chaque terme pondéré est tracé dans `terms` (lisible dans la trace de debug).
 * Les sessions « trajet » ne comptent que dans le terme `trajets`.
 */

import type { LifeConfig } from "./config";
import { travelMinutes } from "./config";
import type { WeekInput } from "./contracts";
import type { FixedItem, PlanSession, Violation } from "./types";

export type PlanScore = {
  total: number;
  /** Contribution PONDÉRÉE de chaque terme (négatif = pénalité). */
  terms: Record<string, number>;
};

/* ------------------------------ Helpers ------------------------------ */

const ERROR_PENALTY = 1000; // filet : l'optimiseur trie déjà par #errors

function minOfDay(iso: string): number {
  return Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
}

function hhmm(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

function isWeekendDay(day: string): boolean {
  const d = new Date(`${day}T12:00:00`).getDay();
  return d === 0 || d === 6;
}

function durMin(s: { start: string; end: string }): number {
  return (new Date(s.end).getTime() - new Date(s.start).getTime()) / 60000;
}

/** Bloc de la timeline d'un jour (session ou événement fixe). */
type Block = {
  start: number;
  end: number;
  placeId?: string;
  category: PlanSession["category"] | "fixed";
};

const WORK_CATEGORIES = new Set(["delos", "monumia", "autre"]);

/* ------------------------------- Score ------------------------------- */

export function scoreWeekPlan(
  cfg: LifeConfig,
  input: WeekInput,
  sessions: PlanSession[],
  fixed: FixedItem[],
  violations: Violation[]
): PlanScore {
  const w = cfg.solver.objective;
  const terms: Record<string, number> = {};

  const real = sessions.filter((s) => s.category !== "trajet");

  /* Violations : erreurs = filet massif, warns = poids configurable. */
  const nErrors = violations.filter((v) => v.severity === "error").length;
  const nWarns = violations.filter((v) => v.severity === "warn").length;
  terms.erreurs = -ERROR_PENALTY * nErrors;
  terms.warns = -w.warn * nWarns;

  /* Timeline par jour : sessions (hors sortie, qui n'ancre pas la compacité)
   * + événements fixes. Le repas matérialisé remplit son créneau, donc le
   * crédit déjeuner est naturellement couvert. */
  const byDay = new Map<string, Block[]>();
  const push = (day: string, b: Block) => {
    const list = byDay.get(day);
    if (list) list.push(b);
    else byDay.set(day, [b]);
  };
  for (const s of real) {
    if (s.category === "sortie") continue;
    push(s.start.slice(0, 10), {
      start: minOfDay(s.start),
      end: minOfDay(s.end),
      placeId: s.placeId,
      category: s.category,
    });
  }
  for (const f of fixed) {
    push(f.start.slice(0, 10), {
      start: minOfDay(f.start),
      end: minOfDay(f.end),
      placeId: f.placeId,
      category: "fixed",
    });
  }

  /* Trous résiduels : entre deux blocs consécutifs d'une journée, le temps
   * au-delà du battement REQUIS (trajet entre lieux, transition, douche) est
   * du temps mort. Le temps libre en bord de journée n'est pas un trou. */
  const transition = cfg.schedule.transitionMin;
  const buffer = cfg.sport.bufferAfterMin;
  let holeMinutes = 0;
  for (const blocks of byDay.values()) {
    const sorted = blocks.slice().sort((a, b) => a.start - b.start);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      const gap = b.start - a.end;
      if (gap <= 0) continue;
      let required = transition;
      if (a.placeId && b.placeId && a.placeId !== b.placeId) {
        const t = travelMinutes(cfg, a.placeId, b.placeId);
        if (t) required = Math.max(required, t.minutes);
      }
      if (a.category === "sport") required += buffer;
      holeMinutes += Math.max(0, gap - required);
    }
  }
  terms.trous = -w.trouParHeure * (holeMinutes / 60);

  /* Monumia : chaque heure AU-DESSUS du plancher rapporte (maximize). */
  const monumiaMin = real
    .filter((s) => s.category === "monumia")
    .reduce((acc, s) => acc + durMin(s), 0);
  terms.monumia =
    w.monumiaParHeure *
    Math.max(0, monumiaMin / 60 - cfg.work.monumia.minHoursPerWeek);

  /* Sport étalé : écart minimal (en jours) entre deux SÉANCES consécutives,
   * cap 3 — les doublons comptent : deux séances le même jour = écart 0.
   * (Mesurer entre jours DISTINCTS récompensait l'empilement : nat+salle
   * mardi + course vendredi donnait le bonus max. Vécu.) Une semaine à 0/1
   * séance reçoit le cap (rien à étaler). */
  const sportDates = real
    .filter((s) => s.category === "sport")
    .map((s) => s.start.slice(0, 10))
    .sort();
  let minGapDays = 3;
  for (let i = 0; i + 1 < sportDates.length; i++) {
    const gap =
      (new Date(`${sportDates[i + 1]}T12:00:00`).getTime() -
        new Date(`${sportDates[i]}T12:00:00`).getTime()) /
      86400000;
    minGapDays = Math.min(minGapDays, gap);
  }
  terms.sportEtalement = w.sportEtalement * minGapDays;

  /* Heure de pointe : minutes de sport dans la plage `rushHours` de son
   * activité (la salle à 17h30, c'est la cohue — un créneau creux vaut mieux). */
  const rushByAct = new Map(
    cfg.sport.activities.filter((a) => a.rushHours).map((a) => [a.id, a.rushHours!])
  );
  let rushMin = 0;
  for (const s of real) {
    if (s.category !== "sport" || !s.activityId) continue;
    const r = rushByAct.get(s.activityId);
    if (!r) continue;
    rushMin += Math.max(
      0,
      Math.min(minOfDay(s.end), hhmm(r.end)) - Math.max(minOfDay(s.start), hhmm(r.start))
    );
  }
  terms.sportHeurePointe = -w.sportHeurePointeParHeure * (rushMin / 60);

  /* Jours off : aucune session travail/sport ET aucun événement fixe (un jour
   * de cours n'est pas off). Le dimanche vide compte — c'est voulu. */
  const monday = new Date(`${input.weekStart}T12:00:00`);
  let joursOff = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const blocks = byDay.get(date) ?? [];
    const busy = blocks.some(
      (b) => b.category === "fixed" || b.category === "sport" || WORK_CATEGORIES.has(b.category)
    );
    if (!busy) joursOff++;
  }
  terms.joursOff = w.jourOff * joursOff;

  /* Travail le week-end : chaque heure de delos/monumia/autre samedi-dimanche
   * coûte (le week-end reste une soupape, pas une habitude). */
  const weekendWorkMin = real
    .filter((s) => WORK_CATEGORIES.has(s.category) && isWeekendDay(s.start.slice(0, 10)))
    .reduce((acc, s) => acc + durMin(s), 0);
  terms.weekendTravail = -w.weekendTravailParHeure * (weekendWorkMin / 60);

  /* Fins tardives : minutes de travail/sport APRÈS finTardiveApres. */
  const lateAfter = hhmm(w.finTardiveApres);
  const lateMin = real
    .filter((s) => WORK_CATEGORIES.has(s.category) || s.category === "sport")
    .reduce((acc, s) => {
      const sMin = minOfDay(s.start);
      const eMin = minOfDay(s.end);
      return acc + Math.max(0, eMin - Math.max(sMin, lateAfter));
    }, 0);
  terms.finsTardives = -w.finTardiveParHeure * (lateMin / 60);

  /* Delos groupé : les demi-journées de présentiel doivent tenir sur le moins
   * de jours Paris possible (2 gabarits/jour). Chaque jour au-delà coûte. */
  const presentiel = real.filter(
    (s) => s.category === "delos" && s.placeId === cfg.work.delos.placeId
  );
  const presDays = new Set(presentiel.map((s) => s.start.slice(0, 10))).size;
  const perDay = Math.max(cfg.work.delos.halfDayWindows.length, 1);
  const minDays = Math.ceil(presentiel.length / perDay);
  terms.delosGroupe = -w.delosJourParisSupplementaire * Math.max(0, presDays - minDays);

  /* Trajets inter-zones : chaque déplacement coûte (nombre + durée). Les blocs
   * « trajet » sont générés par le solveur après le verdict et reflètent la
   * position et la voiture réelles (RER si elle est restée à Orsay) — la
   * durée départage donc naturellement voiture et transports. Aucun malus
   * pour un départ tardif : le trajet de la veille au soir est la façon
   * NORMALE de changer de zone. */
  const trajets = sessions.filter((s) => s.category === "trajet");
  const trajetMin = trajets.reduce((acc, s) => acc + durMin(s), 0);
  terms.trajets = -(w.trajetParTrajet * trajets.length + w.trajetParHeure * (trajetMin / 60));

  /* Charge totale : cours et rendez-vous (fixes hors indisponibilités) + Delos
   * + Monumia + imprévus, au-delà d'un seuil hebdo. C'est ce terme qui fait
   * de Monumia la variable d'ajustement : dans une semaine déjà lourde (cours
   * tous les matins + Delos), chaque heure de plus coûte plus qu'elle ne
   * rapporte. */
  const fixedWorkMin = fixed.filter((f) => !f.indispo).reduce((acc, f) => acc + durMin(f), 0);
  const workMin = real
    .filter((s) => WORK_CATEGORIES.has(s.category))
    .reduce((acc, s) => acc + durMin(s), 0);
  terms.charge =
    -w.chargeParHeure * Math.max(0, (fixedWorkMin + workMin) / 60 - w.chargeSeuilHeures);

  // Normalise le -0 de JS (poids nul × mesure) : un terme éteint vaut 0.
  for (const k of Object.keys(terms)) terms[k] += 0;
  const total = Object.values(terms).reduce((a, b) => a + b, 0);
  return { total, terms };
}

/** Rend un PlanScore lisible pour la trace de debug. */
export function formatScore(score: PlanScore): string {
  const parts = Object.entries(score.terms)
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => `${k}=${v.toFixed(1)}`);
  return `total=${score.total.toFixed(1)} (${parts.join(", ") || "neutre"})`;
}

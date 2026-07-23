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
 * La VARIÉTÉ (une feature voulue) est préservée par un RNG seedé sur weekStart :
 * quels jours deviennent des jours Paris, course le matin ou le soir… varient
 * d'une semaine à l'autre, mais restent reproductibles pour une même semaine.
 * Le contenu (exos, choix des sports, relais des sorties) vient toujours des
 * agents LLM — seul le placement change de mains.
 *
 * L'oracle final reste checkWeekPlan() : le solveur construit pour passer, les
 * tests le prouvent sur de nombreuses semaines. Zéro LLM ici.
 */

import { addDays, toLocalIso } from "../dates";
import type { LifeConfig, SportActivity } from "./config";
import { placeById, travelMinutes } from "./config";
import { checkWeekPlan, MIDDAY } from "./guardrails";
import type { DjimoOut, EmilienOut, JannikOut, WeekInput } from "./contracts";
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

/** jour + minutes → ISO local "YYYY-MM-DDTHH:MM:00". */
function iso(day: string, minutes: number): string {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${day}T${h}:${m}:00`;
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

  const lunch = cfg.schedule.lunchBreak.minMinutes;
  const buffer = cfg.sport.bufferAfterMin;

  // Voisin immédiat AVANT (le bloc dont la fin est la plus proche de s).
  const before = day.occ
    .filter((o) => o.end <= s)
    .sort((a, b) => b.end - a.end)[0];
  if (before?.placeId && place && before.placeId !== place) {
    const t = travelMinutes(cfg, before.placeId, place);
    if (t) {
      let req = t.minutes;
      if (overlap(before.end, s, MIDDAY.start, MIDDAY.end) > 0) req += lunch;
      if (before.category === "sport") req += buffer;
      if (s - before.end < req) return true;
    }
  }

  // Voisin immédiat APRÈS.
  const after = day.occ
    .filter((o) => o.start >= e)
    .sort((a, b) => a.start - b.start)[0];
  if (after?.placeId && place && after.placeId !== place) {
    const t = travelMinutes(cfg, place, after.placeId);
    if (t) {
      let req = t.minutes;
      if (overlap(e, after.start, MIDDAY.start, MIDDAY.end) > 0) req += lunch;
      if (cat === "sport") req += buffer;
      if (after.start - e < req) return true;
    }
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

/* ----------------------------- Le solveur ---------------------------- */

export type SolveArgs = {
  input: WeekInput;
  fixed: FixedItem[];
  emilien?: EmilienOut;
  jannik?: JannikOut;
  djimo?: DjimoOut;
  /** Choix qualitatifs de Josiane (optionnels : sinon tout est seedé au RNG). */
  decisions?: SolverDecisions;
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
  const rng = makeRng(`${input.weekStart}|solver-v3`);
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

  const out: PlanSession[] = [];
  let seq = 0;
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
    return sess;
  };

  /* --------- 2) Sorties DEMANDÉES (obligatoires, ne se négocient pas) ------ */

  const eveningDefaults = ["20:00", "23:00"];
  const weekdayEveningPref = [4, 5, 6, 3]; // vendredi, samedi, dimanche, jeudi (idx)
  const eveningFree = (d: Day) => !d.occ.some((o) => o.start < 23 * 60 && o.end > 20 * 60);

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
    add(day, "sortie", sMin, eMin, {
      title: r.label,
      rationale: "Sortie demandée cette semaine.",
    });
  }

  // Sorties PROPOSÉES par Djimo (soft) : Djimo propose, Josiane choisit le soir
  // (décision), le solveur pose — exactement le schéma « Jannik → sport ». Elles
  // n'écrasent pas une sortie déjà demandée du même label, et cèdent si aucun
  // soir n'est libre (jamais d'erreur, au pire un rappel de quota en warn).
  const normLabel = (s: string) => s.toLowerCase().trim();
  const placedSorties = new Set(
    out.filter((s) => s.category === "sortie").map((s) => normLabel(s.title))
  );
  for (const p of args.djimo?.sorties ?? []) {
    if (placedSorties.has(normLabel(p.label))) continue;
    let day = p.day ? dayByDate.get(p.day) : undefined;
    const dec = !day ? sortieDecisions.get(p.label) : undefined;
    if (!day && dec) {
      const chosen = dayByDate.get(dec.date);
      if (chosen && eveningFree(chosen)) day = chosen;
      else
        rejected.push({
          kind: "sortie",
          ref: p.label,
          reason: chosen ? `soirée du ${dec.date} déjà occupée` : `jour ${dec.date} hors semaine`,
        });
    }
    if (!day) {
      for (const wi of weekdayEveningPref) {
        const d = days[wi];
        if (d && eveningFree(d)) {
          day = d;
          break;
        }
      }
    }
    // Soft : cède si le soir n'est pas libre (jamais de chevauchement forcé).
    if (!day || !eveningFree(day)) {
      emit("info", `sortie: aucun soir libre pour « ${p.label} »`);
      continue;
    }
    const sMin = hhmm(p.start ?? dec?.start ?? eveningDefaults[0]);
    const eMin = Math.min(sMin + (p.durationMin ?? 180), 23 * 60 + 59);
    add(day, "sortie", sMin, eMin, { title: p.label, rationale: "Sortie proposée par Djimo." });
    placedSorties.add(normLabel(p.label));
  }

  /* --------------------- 3) Demi-journées Delos ------------------------ */

  const delosPlace = cfg.work.delos.placeId;
  const nHalf = cfg.work.delos.halfDaysPerWeek;
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
    // posées. Poser via conflicts() garantit qu'aucun guardrail ne lèvera.
    const placeDelos = (
      day: Day,
      wins: { s: number; e: number }[],
      rationale: string
    ): number => {
      let n = 0;
      for (const w of wins) {
        if (placed + n >= nHalf) break;
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
      if (placed >= nHalf) break;
      const day = dayByDate.get(d.date);
      if (!day) {
        rejected.push({ kind: "delos", ref: d.date, reason: "jour hors semaine" });
        continue;
      }
      if (day.weekend) {
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

    // 3b) Complément seedé pour ce qui reste à poser (jours vierges de semaine).
    if (placed < nHalf) {
      const candidates = shuffled(
        days.filter((d) => !d.weekend && !usedDates.has(d.date) && d.occ.length === 0),
        rng
      ).sort(
        (a, b) =>
          (fixedSportWeekdays.has(WEEKDAYS[weekdayIdx(a.date)]) ? 1 : 0) -
          (fixedSportWeekdays.has(WEEKDAYS[weekdayIdx(b.date)]) ? 1 : 0)
      );
      // On empile en journées COMPLÈTES (2 gabarits) tant que possible, le reste
      // en demi-journée simple — « 2 demi-journées le même jour = journée Paris ».
      let ci = 0;
      while (placed < nHalf && ci < candidates.length) {
        const day = candidates[ci++];
        const wantTwo = windows.length >= 2 && nHalf - placed >= 2;
        const wins = wantTwo ? windows.slice(0, 2) : [windows[0]];
        placed += placeDelos(
          day,
          wins,
          wantTwo ? "Demi-journée Delos (gabarit complet)." : "Demi-journée Delos."
        );
      }
    }

    if (placed < nHalf) {
      notes.push(
        `Seulement ${placed}/${nHalf} demi-journées Delos ont pu être posées (pas assez de jours de semaine libres). À voir avec le reste de l'agenda.`
      );
      emit("info", `delos: ${placed}/${nHalf} posées`);
    }
  }

  /* ---------------------------- 4) Sport ------------------------------- */

  const acts = cfg.sport.activities;
  const actById = new Map(acts.map((a) => [a.id, a]));

  // Liste désirée : imposées d'abord, puis celles de Jannik, puis on complète
  // au minimum avec les « voulu ». Plafonnée au max hebdo.
  const desired: SportActivity[] = [];
  for (const a of acts.filter((a) => a.status === "impose")) desired.push(a);
  for (const s of args.jannik?.seances ?? []) {
    const a = actById.get(s.activityId);
    if (a && a.status !== "impose") desired.push(a);
  }
  const voulu = acts.filter((a) => a.status === "voulu");
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

  // Tente de poser une séance à un moment donné (matin ∈ [lo,11:30] ; fin
  // d'après-midi ∈ [16:30,hi]). Renvoie true si posée.
  const placeSportAt = (
    act: SportActivity,
    d: Day,
    dur: number,
    place: string | undefined,
    moment: SportDecision["moment"],
    lo: number,
    hi: number
  ): boolean => {
    const s =
      moment === "matin"
        ? findSlot(cfg, d, dur, place, "sport", lo, Math.min(11 * 60 + 30, hi))
        : findSlot(cfg, d, dur, place, "sport", Math.max(lo, 16 * 60 + 30), hi);
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
      } else if (dec.moment === "matin" && !act.morningOk) {
        rejected.push({ kind: "sport", ref: `${act.id}@${dec.date}`, reason: `${act.name} ne se pratique pas le matin` });
      } else {
        const lo = Math.max(open, d.dayStart);
        const hi = Math.min(close, normalEnd);
        if (placeSportAt(act, d, dur, place, dec.moment, lo, hi)) continue;
        rejected.push({ kind: "sport", ref: `${act.id}@${dec.date}`, reason: "aucun créneau libre au moment choisi (conflit ou récupération)" });
      }
    }

    // Jours éligibles, triés pour étaler : moins de sport d'abord, puis loin de
    // la dernière séance de la même activité, tie-break seedé.
    const lastSame = sportAbs.filter((p) => p.actId === act.id).map((p) => p.s);
    const scored = shuffled(days, rng)
      .filter((d) => eligibleForSport(act, d))
      .map((d) => {
        const sportCount = d.occ.filter((o) => o.category === "sport").length;
        const dist = lastSame.length
          ? Math.min(...lastSame.map((x) => Math.abs(d.idx * 1440 - x)))
          : Infinity;
        // On privilégie la semaine (week-end pénalisé pour keepLight).
        return { d, key: sportCount * 100000 - dist / 1000 + (d.weekend ? 1e6 : 0) };
      })
      .sort((a, b) => a.key - b.key);

    let done = false;
    for (const { d } of scored) {
      const lo = Math.max(open, d.dayStart);
      const hi = Math.min(close, normalEnd);
      // Course/activités « matin ok » : le matin de préférence ; sinon
      // fin d'après-midi (surtout la salle : jamais en plein milieu de journée).
      let s: number | null = null;
      if (act.morningOk) {
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

  /* ------------------- 5) Déjeuner (réservé avant Monumia) ------------- */

  const lunchIdeal = cfg.schedule.lunchBreak.idealMinutes;
  const lunchMin = cfg.schedule.lunchBreak.minMinutes;

  // Réserve un vrai déjeuner (idéalement 60 min) dans un créneau libre du midi.
  // Idempotent : un seul par jour. Appelé ici pour les jours déjà chargés au
  // midi (cours/Delos), et RAPPELÉ au premier bloc Monumia du jour — sinon un
  // jour rempli uniquement de Monumia mangerait tout le midi (0 min pour manger).
  const reserveLunch = (day: Day): void => {
    if (day.occ.some((o) => o.category === "repas")) return;
    let s = findFreeSlot(day, lunchIdeal, 11 * 60 + 45, 14 * 60);
    let dur = lunchIdeal;
    if (s === null) {
      s = findFreeSlot(day, lunchMin, MIDDAY.start, MIDDAY.end);
      dur = lunchMin;
    }
    if (s === null) return; // midi saturé (cours) : lunch-break signalera un warn
    add(day, "repas", s, s + dur, { title: "Déjeuner", rationale: "Pause déjeuner réservée." });
  };

  for (const day of days) {
    // Jours déjà « chargés » autour du midi (cours, Delos) : on cale le déjeuner
    // maintenant, avant tout remplissage Monumia.
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
  // Cible : ce qu'Emilien vise, borné [min+2h, max] pour laisser une marge au
  // pas de minBlock (on ne veut jamais retomber SOUS le plancher).
  const emilienTarget = args.emilien?.monumia.targetHours;
  const target = clamp(
    Math.round((emilienTarget !== undefined ? emilienTarget * 60 : weekMin + 120)),
    Math.min(weekMin + 120, weekMax),
    weekMax
  );
  const chunk = 240; // on pose par blocs ≤ 4h pour étaler la charge

  // Monumia se pose UNIQUEMENT dans le cluster de la journée : pas de lieu de
  // travail parisien un jour Orsay et inversement. Sans lieu adapté → pas de
  // Monumia ce jour-là (évite un trajet inter-cluster fantôme masqué par le déj).
  const monPlace = (day: Day): string | null =>
    mon.preferredPlaceIds.find((p) => placeById(cfg, p)?.cluster === day.cluster) ?? null;

  const perDay = new Map<string, number>();
  let weekTotal = 0;

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

  // Remplit un ensemble de jours en équilibrant (le jour le moins chargé
  // d'abord), jusqu'à `until` minutes hebdo, sans dépasser dailyMax/jour.
  const fill = (pool: Day[], until: number) => {
    const stuck = new Set<string>();
    while (weekTotal < until) {
      let best: Day | null = null;
      let bestVal = Infinity;
      for (const d of pool) {
        if (stuck.has(d.date)) continue;
        const cur = perDay.get(d.date) ?? 0;
        if (cur >= dailyMax) continue;
        if (cur < bestVal) {
          bestVal = cur;
          best = d;
        }
      }
      if (!best) break;
      // Taille bornée par le plafond DUR (weekMax) et le plafond quotidien — pas
      // par la cible molle `until` : sinon le dernier bloc, rogné sous le bloc
      // minimal, serait rejeté et on resterait coincé sous le plancher.
      const room = Math.min(chunk, dailyMax - bestVal, weekMax - weekTotal);
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

  // La semaine d'abord (on vise la cible), le week-end SEULEMENT si le plancher
  // n'est pas atteignable en semaine (keepLight).
  fill(weekdayPool, target);
  if (weekTotal < weekMin) fill(weekendPool, weekMin);

  if (weekTotal < weekMin) {
    notes.push(
      `Monumia : seulement ${(weekTotal / 60).toFixed(1)}h ont pu être casées sur ${(weekMin / 60)}h minimum — semaine trop contrainte (cours, indisponibilités).`
    );
  }

  /* ----------------------- 7) Imprévus / TP --------------------------- */

  // Les imprévus d'Emilien (projets, TP) : blocs « autre » posés avant leur
  // deadline, en semaine, sans dépasser le plafond Monumia du jour restant.
  for (const im of args.emilien?.imprevus ?? []) {
    let remaining = Math.max(minBlock, Math.round(im.hours * 60));
    const deadline = im.deadline ?? dates[dates.length - 1];
    const pool = weekdayPool.filter((d) => d.date <= deadline);
    for (const d of pool) {
      if (remaining < minBlock) break;
      const place = monPlace(d);
      if (!place) continue;
      const s = findSlot(cfg, d, minBlock, place, "autre", d.dayStart, normalEnd);
      if (s === null) continue;
      let e = s + minBlock;
      const cap = Math.min(normalEnd, s + remaining);
      while (e + 15 <= cap && !conflicts(cfg, d, s, e + 15, place, "autre")) e += 15;
      add(d, "autre", s, e, { title: im.label, placeId: place, rationale: "Imprévu / TP de la semaine." });
      remaining -= e - s;
    }
    if (remaining >= minBlock) {
      notes.push(`« ${im.label} » : ${(remaining / 60).toFixed(1)}h n'ont pas pu être casées avant l'échéance.`);
    }
  }

  /* --------------------------- 8) Verdict ------------------------------ */

  out.sort((a, b) => a.start.localeCompare(b.start));
  const violations = checkWeekPlan(cfg, out, fixed, {
    requestedSorties: input.sortiesDatees,
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

  return {
    sessions: out,
    violations,
    warnings: [...notes, ...warns, ...unresolved],
    messages: [],
    attempts: 0,
    rejected,
  };
}

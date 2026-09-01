/**
 * Le PLANIFICATEUR v5 — orchestration minimale, zéro délibération.
 *
 *   WeekInput (rempli par le greffier LLM du chat) ──► placeWeek
 *   (overrides + indisponibilités + optimiseur déterministe) ──► WeekPlan
 *
 * `runCouncil` est PUR vis-à-vis du stockage (événements fixes passés en
 * argument) — c'est lui qu'on teste. Les wrappers *FromStore font les
 * entrées/sorties réelles. Le nom « Conseil » survit côté UI (le mode de
 * chat) ; il n'y a plus d'agents émetteurs ni de transcript : les champs
 * WeekPlan correspondants (transcript, workouts, meals…) sont legacy,
 * conservés en lecture pour les plans historiques.
 */

import { listEvents, getWeekPlan } from "../store";
import { addDays, parseIso } from "../dates";
import type { EventItem, PlannedSession, WeekPlan, WorkoutPlan } from "../types";
import { loadLifeConfig, placeById, type LifeConfig } from "./config";
import type { RetouchOp, WeekInput } from "./contracts";
import type { ChatFn } from "./llm";
import {
  applyRetouchOps,
  placeWeek,
  replanInput,
  retouchWeek,
  type RetouchResult,
} from "./josiane";
import type { OptimizeResult } from "./optimize";
import { createTrace } from "./trace";
import type { FixedItem, PlanSession } from "./types";

export type CouncilOptions = {
  /** Client de chat injectable — utilisé UNIQUEMENT par la retouche. */
  chat?: ChatFn;
  model?: string;
  /** Trace de debug (voir trace.ts) — branchée automatiquement par runCouncilFromStore. */
  onEvent?: (agent: string, kind: "system" | "request" | "response" | "invalid" | "violations" | "repair" | "info", content: string) => void;
};

/* --------------------------- Résolution lieux ------------------------ */

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Best-effort : rattache un texte de lieu d'événement à un lieu de la config. */
export function resolvePlaceId(cfg: LifeConfig, text?: string): string | undefined {
  if (!text) return undefined;
  const n = norm(text);
  const hit = cfg.places.find(
    (p) => norm(p.name).includes(n) || n.includes(norm(p.name))
  );
  return hit?.id;
}

/** Catégories d'événements fixes assimilées à des cours (lieu = la fac). */
const COURSE_CATEGORIES = new Set(["cours", "travail", "études", "etudes", "étude", "etude"]);

/**
 * Événements fixes de la semaine (hors sessions d'un plan précédent).
 * Un événement SANS lieu mais de catégorie cours/travail est rattaché au lieu
 * des cours de la config : sans ça, les guardrails de trajet ne peuvent pas
 * protéger les enchaînements autour des cours.
 */
export function eventsToFixed(cfg: LifeConfig, events: EventItem[]): FixedItem[] {
  return events.map((e) => {
    let placeId = resolvePlaceId(cfg, e.location);
    if (!placeId && COURSE_CATEGORIES.has((e.category || "").toLowerCase())) {
      placeId = cfg.work.cours.placeId;
    }
    return {
      id: e.id,
      title: e.title,
      start: e.start,
      end: e.end,
      placeId,
    };
  });
}

/* --------------------------- Mapping WeekPlan ------------------------ */

function toPlannedSessions(cfg: LifeConfig, sessions: PlanSession[]): PlannedSession[] {
  return sessions.map((s) => ({
    id: s.id,
    activityId: s.activityId,
    title: s.title,
    placeId: s.placeId,
    placeName: s.placeId ? placeById(cfg, s.placeId)?.name : undefined,
    start: s.start,
    end: s.end,
    category: s.category,
    rationale: s.rationale,
  }));
}

/* ---------------------------- Pipeline pur --------------------------- */

/**
 * Planification complète sur données fournies. Ne lit ni n'écrit rien :
 * renvoie le WeekPlan (non commité) au format historique. Aucun appel LLM —
 * la demande est déjà structurée (WeekInput), le placement est pur calcul.
 */
export async function runCouncil(
  cfg: LifeConfig,
  input: WeekInput,
  fixed: FixedItem[],
  opts: CouncilOptions = {}
): Promise<WeekPlan> {
  console.log(`[planificateur] semaine ${input.weekStart} — solveur…`);
  // Trace : ce que le solveur reçoit RÉELLEMENT (la WeekInput du greffier et
  // les événements fixes) — sans ça, impossible de diagnostiquer un plan raté.
  opts.onEvent?.(
    "planificateur",
    "request",
    JSON.stringify({ input, fixed }, null, 1)
  );
  const placement = await placeWeek(cfg, { input, fixed }, { onEvent: opts.onEvent });
  console.log(
    `[planificateur] ${placement.sessions.length} sessions, ${placement.violations.length} violation(s) restante(s)`
  );

  const blockingErrors = placement.violations
    .filter((v) => v.severity === "error")
    .map((v) => v.message);

  // Transparence : tout override de quota appliqué est affiché — si le greffier
  // en a halluciné un (vécu : les quotas mis à 0 pour « aider »), ça se VOIT.
  // Même chose pour la surcharge sport (vécu : la rotation par défaut recopiée
  // dans `imposer`) et pour les décisions non honorées (sinon la demi-journée
  // demandée disparaît sans que personne ne sache pourquoi).
  const overrideNotes = Object.entries(input.overrides)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`);
  const sportNotes = [
    ...input.sport.exclure.map((id) => `sans ${id}`),
    ...input.sport.imposer.map((i) => `${i.activityId}×${i.fois}`),
  ];
  const rejectedNotes = placement.rejected.map(
    (r) => `Demande non honorée (${r.kind} ${r.ref}) : ${r.reason} — le solveur a choisi à sa place.`
  );
  const warnings = [
    ...(overrideNotes.length
      ? [
          `⚠️ Exceptions aux quotas appliquées cette semaine : ${overrideNotes.join(", ")}. Si tu ne les as pas demandées, relance en précisant que les quotas sont normaux.`,
        ]
      : []),
    ...(sportNotes.length
      ? [
          `⚠️ Surcharge sport appliquée cette semaine : ${sportNotes.join(", ")}. Si tu ne l'as pas demandée, relance en précisant que la rotation est normale.`,
        ]
      : []),
    ...rejectedNotes,
    ...placement.warnings,
  ];

  return {
    weekStart: input.weekStart,
    blockingErrors: blockingErrors.length ? blockingErrors : undefined,
    sessions: toPlannedSessions(cfg, placement.sessions),
    warnings: warnings.length ? warnings : undefined,
    // La demande est stockée AVEC le plan : c'est elle qu'une replanification
    // (« décale ma muscu à jeudi ») patche puis re-résout.
    input,
    summary: summarize(cfg, placement),
  };
}

/** Résumé lisible du verdict — ce que le greffier relaie pour expliquer le plan. */
function summarize(cfg: LifeConfig, placement: OptimizeResult): string {
  const dur = (s: { start: string; end: string }) =>
    (new Date(s.end).getTime() - new Date(s.start).getTime()) / 3600000;
  const isWeekend = (iso: string) => [0, 6].includes(new Date(iso).getDay());
  const monumia = placement.sessions.filter((s) => s.category === "monumia");
  const monumiaH = monumia.reduce((a, s) => a + dur(s), 0);
  const weekendH = monumia.filter((s) => isWeekend(s.start)).reduce((a, s) => a + dur(s), 0);
  const delosDays = [
    ...new Set(
      placement.sessions
        .filter((s) => s.category === "delos" && s.placeId === cfg.work.delos.placeId)
        .map((s) => WEEKDAYS_FR[new Date(s.start).getDay()])
    ),
  ];
  const trajets = placement.sessions.filter((s) => s.category === "trajet");
  const trajetMin = Math.round(trajets.reduce((a, s) => a + dur(s), 0) * 60);
  const fmtH = (h: number) => (Number.isInteger(h) ? `${h}` : h.toFixed(1));
  return [
    `Monumia ${fmtH(monumiaH)}h (cible ${fmtH(placement.monumiaTargetHours)}h${weekendH ? `, dont ${fmtH(weekendH)}h le week-end` : ", week-end libre"})`,
    `Delos présentiel : ${delosDays.join(" et ") || "aucun"}`,
    `${trajets.length} trajet(s) inter-zones (${trajetMin} min)`,
    `${placement.candidatesTried} candidats évalués, score ${placement.score.total.toFixed(1)}`,
  ].join(" · ");
}

const WEEKDAYS_FR = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/* ------------------------- Wrappers stockage ------------------------- */

/** Charge les événements fixes de la semaine (hors sessions d'un plan). */
async function loadWeekFixed(cfg: LifeConfig, weekStart: string): Promise<FixedItem[]> {
  const all = await listEvents();
  const start = parseIso(`${weekStart}T00:00:00`);
  const end = addDays(start, 7);
  const inWeek = all.filter((e) => {
    if (e.source === "plan") return false;
    const d = parseIso(e.start);
    return d >= start && d < end;
  });
  return eventsToFixed(cfg, inWeek);
}

/** Planification complète depuis le stockage réel (plan NON commité), avec trace. */
export async function runCouncilFromStore(
  input: WeekInput,
  opts: CouncilOptions = {}
): Promise<WeekPlan> {
  const trace = createTrace(input.weekStart);
  try {
    const cfg = await loadLifeConfig();
    const fixed = await loadWeekFixed(cfg, input.weekStart);
    return await runCouncil(cfg, input, fixed, {
      ...opts,
      onEvent: opts.onEvent ?? trace.onEvent,
    });
  } finally {
    trace
      .save()
      .then((file) => console.log(`[planificateur] trace de debug : ${file}`))
      .catch(() => {});
  }
}

/** PlannedSession (stocké) → PlanSession (avec ids stables). */
function toPlanSessions(previous: WeekPlan): PlanSession[] {
  return previous.sessions.map((s, i) => ({
    id: s.id || `r${i + 1}`,
    title: s.title,
    category: (s.category as PlanSession["category"]) || "autre",
    activityId: s.activityId,
    placeId: s.placeId,
    start: s.start,
    end: s.end,
    rationale: s.rationale,
  }));
}

/**
 * Sessions du plan d'une semaine avec leurs ids — ce que Josiane doit voir pour
 * cibler une opération. Les événements de l'agenda ne portent pas ces ids.
 */
export async function listPlanSessionsFromStore(
  weekStart: string
): Promise<{ weekStart: string; sessions: PlanSession[] } | null> {
  const previous = await getWeekPlan(weekStart);
  if (!previous) return null;
  return { weekStart, sessions: toPlanSessions(previous) };
}

/**
 * Applique des opérations DÉJÀ connues au plan stocké — aucun appel LLM.
 * Même validation et même reconstruction que la retouche par le solveur.
 */
export async function applyPlanOpsFromStore(
  weekStart: string,
  operations: RetouchOp[]
): Promise<WeekPlan | null> {
  const cfg = await loadLifeConfig();
  const previous = await getWeekPlan(weekStart);
  if (!previous) return null;
  const fixed = await loadWeekFixed(cfg, weekStart);
  const sessions = toPlanSessions(previous);
  const result = applyRetouchOps(cfg, { sessions, fixed, operations });
  return rebuildPlan(cfg, previous, result);
}

/**
 * REPLANIFICATION du plan stocké (v5.1) : la demande d'origine (stockée avec le
 * plan) est patchée par le LLM depuis la consigne, puis TOUTE la semaine est
 * re-résolue par le solveur — plan NON commité (carte à valider). Un plan
 * historique sans demande stockée retombe sur la retouche par opérations.
 */
export async function replanPlanFromStore(
  weekStart: string,
  changeNote: string,
  opts: CouncilOptions = {}
): Promise<WeekPlan | null> {
  const cfg = await loadLifeConfig();
  const previous = await getWeekPlan(weekStart);
  if (!previous) return null;
  if (!previous.input) return retouchPlanFromStore(weekStart, changeNote, opts);

  const trace = createTrace(weekStart);
  const onEvent = opts.onEvent ?? trace.onEvent;
  try {
    const fixed = await loadWeekFixed(cfg, weekStart);
    const { input, patch } = await replanInput(
      cfg,
      { input: previous.input, changeNote, sessions: toPlanSessions(previous), fixed },
      { chat: opts.chat, model: opts.model, onEvent }
    );
    onEvent("replanification", "info", `patch appliqué :\n${JSON.stringify(patch, null, 1)}`);
    const plan = await runCouncil(cfg, input, fixed, { ...opts, onEvent });
    const warnings = [...patch.warnings.map((w) => `Non traduit : ${w}`), ...(plan.warnings ?? [])];
    return { ...plan, warnings: warnings.length ? warnings : undefined, committed: false };
  } finally {
    trace
      .save()
      .then((file) => console.log(`[planificateur] trace de debug : ${file}`))
      .catch(() => {});
  }
}

/** Retouche par opérations LLM (repli : plans sans demande stockée), plan NON commité. */
export async function retouchPlanFromStore(
  weekStart: string,
  changeNote: string,
  opts: CouncilOptions = {}
): Promise<WeekPlan | null> {
  const cfg = await loadLifeConfig();
  const previous = await getWeekPlan(weekStart);
  if (!previous) return null;
  const fixed = await loadWeekFixed(cfg, weekStart);
  const sessions = toPlanSessions(previous);

  const result = await retouchWeek(
    cfg,
    { weekStart, changeNote, sessions, fixed },
    { chat: opts.chat, model: opts.model }
  );

  return rebuildPlan(cfg, previous, result);
}

/** Plan précédent + sessions retouchées → WeekPlan complet (workouts remappés). */
function rebuildPlan(
  cfg: Awaited<ReturnType<typeof loadLifeConfig>>,
  previous: WeekPlan,
  result: RetouchResult
): WeekPlan {
  // Les workouts (legacy, plans historiques) suivent leurs séances
  // (rematch par titre puis par ordre) — plus jamais produits en v5.
  const oldWorkouts = previous.workouts || [];
  const usedW = new Set<number>();
  const workouts: WorkoutPlan[] = result.sessions
    .filter((s) => s.category === "sport")
    .map((s) => {
      let idx = oldWorkouts.findIndex((w, i) => !usedW.has(i) && w.title === s.title);
      if (idx === -1) idx = oldWorkouts.findIndex((_, i) => !usedW.has(i));
      const w = idx !== -1 ? oldWorkouts[idx] : undefined;
      if (idx !== -1) usedW.add(idx);
      return {
        sessionStart: s.start,
        title: s.title,
        intensity: w?.intensity,
        exercises: w?.exercises || [],
        tips: w?.tips || [],
      };
    });

  return {
    ...previous,
    sessions: toPlannedSessions(cfg, result.sessions),
    workouts: oldWorkouts.length ? workouts : undefined,
    warnings: result.warnings.length ? result.warnings : undefined,
    blockingErrors: result.blockingErrors.length ? result.blockingErrors : undefined,
    committed: false,
  };
}

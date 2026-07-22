/**
 * Le CONSEIL v2 — orchestrateur du pipeline complet.
 *
 *   WeekInput ──► { Emilien ∥ Jannik ∥ Djimo } ──► placeWeek (Josiane +
 *   guardrails + réparation) ──► Simone (repas sur la semaine figée)
 *   ──► WeekPlan (format historique : store/commit/UI inchangés)
 *
 * `runCouncil` est PUR vis-à-vis du stockage (événements fixes et séances
 * récentes passés en argument) — c'est lui qu'on teste. Les wrappers *FromStore
 * font les entrées/sorties réelles.
 */

import { MODELS } from "../mistral";
import { listEvents, getWeekPlan } from "../store";
import { addDays, parseIso } from "../dates";
import type {
  CouncilMessage,
  EventItem,
  GroceryList,
  MealPlan,
  PlannedSession,
  WeekPlan,
  WorkoutPlan,
} from "../types";
import { loadLifeConfig, placeById, type LifeConfig } from "./config";
import {
  DjimoOutSchema,
  EmilienOutSchema,
  JannikOutSchema,
  SimoneOutSchema,
  type DjimoOut,
  type EmilienOut,
  type JannikOut,
  type SimoneOut,
  type WeekInput,
} from "./contracts";
import { callJson, type ChatFn } from "./llm";
import { placeWeek, retouchWeek, weekDates, type PlacementResult } from "./josiane";
import {
  buildDjimoSystem,
  buildEmilienSystem,
  buildJannikSystem,
  buildSimoneSystem,
} from "./prompts";
import type { FixedItem, PlanSession } from "./types";

export type CouncilOptions = {
  chat?: ChatFn;
  /** Modèle des émetteurs/Simone (défaut : MODELS.small via mistral.ts). */
  model?: string;
  plannerModel?: string;
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

/** Événements fixes de la semaine (hors sessions d'un plan précédent). */
export function eventsToFixed(cfg: LifeConfig, events: EventItem[]): FixedItem[] {
  return events.map((e) => ({
    id: e.id,
    title: e.title,
    start: e.start,
    end: e.end,
    placeId: resolvePlaceId(cfg, e.location),
  }));
}

/* ------------------------ Contenus utilisateur ----------------------- */

const WEEKDAYS = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
] as const;

function labelOf(day: string): string {
  return `${WEEKDAYS[new Date(`${day}T12:00:00`).getDay()]} ${day}`;
}

function daysBlock(weekStart: string): string {
  return weekDates(weekStart).map((d) => `- ${labelOf(d)}`).join("\n");
}

function fixedBlock(fixed: FixedItem[]): string {
  if (fixed.length === 0) return "(aucun — semaine libre)";
  return fixed
    .map(
      (f) =>
        `- ${labelOf(f.start.slice(0, 10))} ${f.start.slice(11, 16)}-${f.end.slice(11, 16)} : ${f.title}`
    )
    .join("\n");
}

function inputBlock(input: WeekInput): string {
  return `DEMANDE DE LA SEMAINE :
- Imprévus/TP : ${input.imprevus.length ? JSON.stringify(input.imprevus) : "(aucun)"}
- Sorties déjà prévues : ${input.sortiesDatees.length ? JSON.stringify(input.sortiesDatees) : "(aucune)"}
- Indisponibilités : ${input.indisponibilites.length ? JSON.stringify(input.indisponibilites) : "(aucune)"}
- Voiture disponible : ${input.voitureDispo ? "oui" : "non"}
- Exceptions aux quotas : ${Object.keys(input.overrides).length ? JSON.stringify(input.overrides) : "(aucune)"}
- Notes : """${input.notes || "(rien)"}"""`;
}

/* ----------------------------- Émetteurs ----------------------------- */

async function runEmitters(
  cfg: LifeConfig,
  input: WeekInput,
  fixed: FixedItem[],
  recentSport: EventItem[],
  opts: CouncilOptions
): Promise<{ emilien: EmilienOut; jannik: JannikOut; djimo: DjimoOut }> {
  const model = opts.model || MODELS.small;
  const common = `SEMAINE :\n${daysBlock(input.weekStart)}\n\n${inputBlock(input)}`;

  const recent =
    recentSport.length > 0
      ? recentSport
          .map((e) => `- ${labelOf(e.start.slice(0, 10))} : ${e.title}`)
          .join("\n")
      : "(aucune séance les 7 derniers jours)";

  const [emilien, jannik, djimo] = await Promise.all([
    callJson(EmilienOutSchema, {
      agent: "emilien",
      model,
      system: buildEmilienSystem(cfg),
      user: `${common}\n\nÉVÉNEMENTS DÉJÀ FIXÉS (dont les cours) :\n${fixedBlock(fixed)}`,
      chat: opts.chat,
    }),
    callJson(JannikOutSchema, {
      agent: "jannik",
      model,
      system: buildJannikSystem(cfg),
      user: `${common}\n\nSÉANCES RÉCENTES (récupération) :\n${recent}`,
      chat: opts.chat,
    }),
    callJson(DjimoOutSchema, {
      agent: "djimo",
      model,
      system: buildDjimoSystem(cfg),
      user: common,
      chat: opts.chat,
    }),
  ]);
  return { emilien, jannik, djimo };
}

/* ------------------------------- Simone ------------------------------ */

function scheduleForSimone(cfg: LifeConfig, sessions: PlanSession[]): string {
  if (sessions.length === 0) return "(semaine vide)";
  const intensity = (s: PlanSession) =>
    s.activityId
      ? cfg.sport.activities.find((a) => a.id === s.activityId)?.intensity
      : undefined;
  return sessions
    .map((s) => {
      const i = intensity(s);
      return `- ${labelOf(s.start.slice(0, 10))} ${s.start.slice(11, 16)}-${s.end.slice(11, 16)} : ${s.title} [${s.category}${i ? `, intensité ${i}` : ""}]`;
    })
    .join("\n");
}

async function runSimone(
  cfg: LifeConfig,
  input: WeekInput,
  fixed: FixedItem[],
  sessions: PlanSession[],
  opts: CouncilOptions
): Promise<SimoneOut> {
  const user = `SEMAINE :\n${daysBlock(input.weekStart)}

COURS & ÉVÉNEMENTS FIXES (repère les jours avec cours LE MATIN → déjeuner au CROUS ce jour-là) :
${fixedBlock(fixed)}

EMPLOI DU TEMPS PLACÉ (charge, séances de sport et leur intensité) :
${scheduleForSimone(cfg, sessions)}

INDISPONIBILITÉS (jours « chez les parents » → aucun repas) :
${input.indisponibilites.length ? JSON.stringify(input.indisponibilites) : "(aucune)"}

NOTES DE LA SEMAINE :
"""${input.notes || "(rien)"}"""`;
  return callJson(SimoneOutSchema, {
    agent: "simone",
    model: opts.model || MODELS.small,
    system: buildSimoneSystem(cfg),
    user,
    chat: opts.chat,
  });
}

/** Filet déterministe : aucun aliment banni ne survit dans les repas. */
export function scrubDisliked(meals: MealPlan[], disliked: string[]): MealPlan[] {
  const terms = disliked.map(norm).filter(Boolean);
  if (terms.length === 0) return meals;
  const hits = (text: string) => {
    const t = norm(text).replace(/huile d['e ]?olives?/g, " ");
    return terms.some((term) => t.includes(term.replace(/s$/, "")));
  };
  return meals.map((m) => ({
    ...m,
    ingredients: m.ingredients.filter((i) => !hits(i.name)),
    steps: m.steps.filter((s) => !hits(s)),
  }));
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

/** Associe les exercices/conseils de Jannik aux séances placées (par activité). */
export function buildWorkouts(
  cfg: LifeConfig,
  sessions: PlanSession[],
  jannik: JannikOut
): WorkoutPlan[] {
  const used = new Set<number>();
  return sessions
    .filter((s) => s.category === "sport")
    .map((s) => {
      let idx = jannik.seances.findIndex(
        (j, i) => !used.has(i) && j.activityId === s.activityId
      );
      if (idx === -1) idx = jannik.seances.findIndex((_, i) => !used.has(i));
      const j = idx !== -1 ? jannik.seances[idx] : undefined;
      if (idx !== -1) used.add(idx);
      const intensity = s.activityId
        ? cfg.sport.activities.find((a) => a.id === s.activityId)?.intensity
        : undefined;
      return {
        sessionStart: s.start,
        title: s.title,
        intensity,
        exercises: j?.exercises || [],
        tips: j?.tips || [],
      };
    });
}

function toTranscript(
  briefs: { emilien: EmilienOut; jannik: JannikOut; djimo: DjimoOut },
  placement: PlacementResult
): CouncilMessage[] {
  const out: CouncilMessage[] = [];
  for (const [from, msg] of [
    ["emilien", briefs.emilien.messageToJosiane],
    ["jannik", briefs.jannik.messageToJosiane],
    ["djimo", briefs.djimo.messageToJosiane],
  ] as const) {
    if (msg) out.push({ from, to: "josiane", text: msg, round: 0 });
  }
  for (const m of placement.messages) {
    out.push({ from: "josiane", to: m.to, text: m.text, round: 0 });
  }
  return out;
}

/* ---------------------------- Pipeline pur --------------------------- */

/**
 * Pipeline complet du Conseil sur données fournies. Ne lit ni n'écrit rien :
 * renvoie le WeekPlan (non commité) au format historique.
 */
export async function runCouncil(
  cfg: LifeConfig,
  input: WeekInput,
  fixed: FixedItem[],
  recentSport: EventItem[],
  opts: CouncilOptions = {}
): Promise<WeekPlan> {
  console.log(`[conseil] semaine ${input.weekStart} — émetteurs (Emilien, Jannik, Djimo)…`);
  const briefs = await runEmitters(cfg, input, fixed, recentSport, opts);

  console.log("[conseil] Josiane place…");
  const placement = await placeWeek(
    cfg,
    { input, fixed, ...briefs },
    { chat: opts.chat, model: opts.plannerModel }
  );
  console.log(
    `[conseil] placement : ${placement.sessions.length} sessions en ${placement.attempts} appel(s), ${placement.violations.length} violation(s) restante(s)`
  );

  console.log("[conseil] Simone cuisine…");
  const simone = await runSimone(cfg, input, fixed, placement.sessions, opts);
  const meals = scrubDisliked(simone.meals, cfg.cuisine.dislikedFoods);

  return {
    weekStart: input.weekStart,
    sessions: toPlannedSessions(cfg, placement.sessions),
    workouts: buildWorkouts(cfg, placement.sessions, briefs.jannik),
    meals,
    groceries: { items: simone.groceries } as GroceryList,
    transcript: toTranscript(briefs, placement),
    coachNote: briefs.jannik.summary || undefined,
    warnings: placement.warnings.length ? placement.warnings : undefined,
  };
}

/* ------------------------- Wrappers stockage ------------------------- */

/** Charge les événements fixes de la semaine + séances de sport récentes. */
async function loadWeekContext(cfg: LifeConfig, weekStart: string) {
  const all = await listEvents();
  const start = parseIso(`${weekStart}T00:00:00`);
  const end = addDays(start, 7);
  const recentFrom = addDays(start, -7);
  const notPlan = all.filter((e) => e.source !== "plan");
  const inRange = (e: EventItem, from: Date, to: Date) => {
    const d = parseIso(e.start);
    return d >= from && d < to;
  };
  return {
    fixed: eventsToFixed(cfg, notPlan.filter((e) => inRange(e, start, end))),
    recentSport: notPlan.filter(
      (e) => (e.category || "").toLowerCase() === "sport" && inRange(e, recentFrom, start)
    ),
  };
}

/** Conseil complet depuis le stockage réel (plan NON commité). */
export async function runCouncilFromStore(
  input: WeekInput,
  opts: CouncilOptions = {}
): Promise<WeekPlan> {
  const cfg = await loadLifeConfig();
  const { fixed, recentSport } = await loadWeekContext(cfg, input.weekStart);
  return runCouncil(cfg, input, fixed, recentSport, opts);
}

/** Retouche du plan stocké pour une semaine (plan NON commité). */
export async function retouchPlanFromStore(
  weekStart: string,
  changeNote: string,
  opts: CouncilOptions = {}
): Promise<WeekPlan | null> {
  const cfg = await loadLifeConfig();
  const previous = await getWeekPlan(weekStart);
  if (!previous) return null;
  const { fixed } = await loadWeekContext(cfg, weekStart);

  // PlannedSession (stocké) → PlanSession (avec ids stables).
  const sessions: PlanSession[] = previous.sessions.map((s, i) => ({
    id: s.id || `r${i + 1}`,
    title: s.title,
    category: (s.category as PlanSession["category"]) || "autre",
    activityId: s.activityId,
    placeId: s.placeId,
    start: s.start,
    end: s.end,
    rationale: s.rationale,
  }));

  const result = await retouchWeek(
    cfg,
    { weekStart, changeNote, sessions, fixed },
    { chat: opts.chat, model: opts.plannerModel }
  );

  // Les workouts suivent leurs séances (rematch par titre puis par ordre).
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
    workouts,
    transcript: result.messages.map((m) => ({
      from: "josiane" as const,
      to: m.to,
      text: m.text,
      round: 0,
    })),
    warnings: result.warnings.length ? result.warnings : undefined,
    committed: false,
  };
}

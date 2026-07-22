/**
 * Josiane v2 — le placement, avec sa BOUCLE DE RÉPARATION.
 *
 *   briefs (Emilien/Jannik/Djimo) + événements fixes + demande hebdo
 *        │
 *        ▼
 *   Josiane (LLM, température non nulle : la variété des semaines vit ici)
 *        │
 *        ▼
 *   guardrails ──erreurs?──► re-prompt ciblé (les violations, rien d'autre)
 *        │                    × MAX_REPAIR_ROUNDS, puis réparation mécanique
 *        ▼
 *   PlanSession[] + violations restantes (warnings honnêtes)
 *
 * Les overrides de la demande (ex: « Marine absente » → sortiesMarineMin: 0)
 * sont appliqués à une COPIE de la config avant tout : prompts et guardrails
 * jugent avec les mêmes règles ajustées. Les indisponibilités deviennent des
 * blocs fixes : y poser quoi que ce soit = chevauchement détecté.
 */

import { MODELS } from "../mistral";
import { addDays, toLocalIso } from "../dates";
import type { LifeConfig } from "./config";
import type {
  DjimoOut,
  EmilienOut,
  JannikOut,
  JosianeOut,
  JosianeRetouchOut,
  RetouchOp,
  WeekInput,
} from "./contracts";
import { JosianeOutSchema, JosianeRetouchOutSchema } from "./contracts";
import { checkWeekPlan } from "./guardrails";
import { callJson, type ChatFn } from "./llm";
import { buildJosianeRetouchSystem, buildJosianeSystem } from "./prompts";
import { mechanicalRepair } from "./repair";
import type { FixedItem, PlanSession, Violation } from "./types";

const MAX_REPAIR_ROUNDS = 2;

const WEEKDAYS = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
] as const;

/* ----------------------------- Utilitaires --------------------------- */

/** Les 7 dates (YYYY-MM-DD) de la semaine commençant à weekStart (lundi). */
export function weekDates(weekStart: string): string[] {
  const monday = new Date(`${weekStart}T12:00:00`);
  return Array.from({ length: 7 }, (_, i) =>
    toLocalIso(addDays(monday, i)).slice(0, 10)
  );
}

function labelOf(day: string): string {
  return `${WEEKDAYS[new Date(`${day}T12:00:00`).getDay()]} ${day}`;
}

/** Copie de la config avec les overrides hebdo appliqués. */
export function applyOverrides(cfg: LifeConfig, input: WeekInput): LifeConfig {
  const o = input.overrides;
  const next: LifeConfig = JSON.parse(JSON.stringify(cfg));
  if (o.sortiesMarineMin !== undefined) next.sorties.copine.perWeekMin = o.sortiesMarineMin;
  if (o.sportSessionsMax !== undefined) {
    next.sport.sessionsPerWeekMax = o.sportSessionsMax;
    next.sport.sessionsPerWeekMin = Math.min(next.sport.sessionsPerWeekMin, o.sportSessionsMax);
  }
  if (o.monumiaMinHours !== undefined) next.work.monumia.minHoursPerWeek = o.monumiaMinHours;
  if (o.delosHalfDays !== undefined) next.work.delos.halfDaysPerWeek = o.delosHalfDays;
  if (!input.voitureDispo) next.ownedModes = next.ownedModes.filter((m) => m !== "voiture");
  return next;
}

/** Les indisponibilités deviennent des blocs FIXES (rien ne peut s'y poser). */
export function indispoAsFixed(cfg: LifeConfig, input: WeekInput): FixedItem[] {
  return input.indisponibilites.map((ind, i) => ({
    id: `indispo-${i}`,
    title: `Indisponible${ind.reason ? ` (${ind.reason})` : ""}`,
    start: `${ind.day}T${ind.from ?? cfg.schedule.dayStart}:00`,
    end: `${ind.day}T${ind.to ?? cfg.schedule.exceptionalEnd}:00`,
  }));
}

/** Matérialise la sortie de Josiane en PlanSession[] (ids stables, hors-semaine écarté). */
export function materialize(out: JosianeOut, weekStart: string): PlanSession[] {
  const days = new Set(weekDates(weekStart));
  const sessions: PlanSession[] = [];
  out.sessions.forEach((s, i) => {
    if (!days.has(s.day)) return; // hors de la semaine visée
    if (s.end <= s.start) return;
    sessions.push({
      id: `s${i + 1}-${s.category}`,
      title: s.title,
      category: s.category,
      activityId: s.activityId ?? undefined,
      placeId: s.placeId ?? undefined,
      start: `${s.day}T${s.start}:00`,
      end: `${s.day}T${s.end}:00`,
      exceptional: s.exceptional || undefined,
      rationale: s.rationale || undefined,
    });
  });
  sessions.sort((a, b) => a.start.localeCompare(b.start));
  return sessions;
}

/* ------------------------- Contexte utilisateur ---------------------- */

function fixedBlock(fixed: FixedItem[]): string {
  if (fixed.length === 0) return "(aucun — semaine libre)";
  return fixed
    .map((f) => `- ${labelOf(f.start.slice(0, 10))} ${f.start.slice(11, 16)}-${f.end.slice(11, 16)} : ${f.title}${f.placeId ? ` [${f.placeId}]` : ""}`)
    .join("\n");
}

function placementUserContent(
  weekStart: string,
  fixed: FixedItem[],
  input: WeekInput,
  briefs: { emilien: EmilienOut; jannik: JannikOut; djimo: DjimoOut }
): string {
  return `SEMAINE À PLANIFIER (utilise ces dates exactes) :
${weekDates(weekStart).map(labelOf).map((l) => `- ${l}`).join("\n")}

ÉVÉNEMENTS DÉJÀ FIXÉS (intouchables, ne les recrée pas — inclut les indisponibilités) :
${fixedBlock(fixed)}

BESOINS D'EMILIEN (travail) :
${JSON.stringify(briefs.emilien, null, 1)}

SÉANCES DE JANNIK (sport — place ce qui rentre, dans cet ordre de fournitures) :
${JSON.stringify(briefs.jannik.seances, null, 1)}

SORTIES DE DJIMO :
${JSON.stringify(briefs.djimo.sorties, null, 1)}

DEMANDE DE LA SEMAINE :
- Voiture disponible : ${input.voitureDispo ? "oui" : "NON (trajets inter-zones en transports uniquement)"}
- Notes : """${input.notes || "(rien)"}"""

Produis le planning complet de la semaine.`;
}

/* ------------------------- Boucle de placement ----------------------- */

export type PlacementResult = {
  sessions: PlanSession[];
  /** Violations restantes après boucle + réparation (erreurs non résolues et warns). */
  violations: Violation[];
  /** Warnings pour l'utilisateur : ceux de Josiane + réparations + non-résolus. */
  warnings: string[];
  messages: JosianeOut["messages"];
  /** Nombre d'appels LLM effectués (1 = du premier coup). */
  attempts: number;
};

export type PlacementOptions = {
  chat?: ChatFn;
  model?: string;
  temperature?: number;
  maxRepairRounds?: number;
};

function violationsBlock(violations: Violation[]): string {
  return violations
    .filter((v) => v.severity === "error")
    .map((v) => `- [${v.rule}] ${v.message}`)
    .join("\n");
}

/**
 * Place la semaine : Josiane, puis guardrails, re-prompts ciblés, réparation
 * mécanique. Ne lève pas sur violations restantes — elles sont renvoyées.
 */
export async function placeWeek(
  baseCfg: LifeConfig,
  args: {
    input: WeekInput;
    fixed: FixedItem[];
    emilien: EmilienOut;
    jannik: JannikOut;
    djimo: DjimoOut;
  },
  opts: PlacementOptions = {}
): Promise<PlacementResult> {
  const cfg = applyOverrides(baseCfg, args.input);
  const fixed = [...args.fixed, ...indispoAsFixed(cfg, args.input)];
  const system = buildJosianeSystem(cfg);
  const user = placementUserContent(args.input.weekStart, fixed, args.input, args);
  const model = opts.model || MODELS.planner;
  const maxRounds = opts.maxRepairRounds ?? MAX_REPAIR_ROUNDS;

  let attempts = 0;
  const call = async (userContent: string): Promise<JosianeOut> => {
    attempts++;
    return callJson(JosianeOutSchema, {
      agent: "josiane",
      model,
      system,
      user: userContent,
      temperature: opts.temperature ?? 0.5,
      chat: opts.chat,
    });
  };

  let out = await call(user);
  let sessions = materialize(out, args.input.weekStart);
  let violations = checkWeekPlan(cfg, sessions, fixed);

  // Re-prompts ciblés : uniquement les erreurs, planning actuel joint.
  for (let round = 0; round < maxRounds; round++) {
    if (!violations.some((v) => v.severity === "error")) break;
    const repromptUser = `${user}

TON PLANNING PRÉCÉDENT :
${JSON.stringify(out.sessions, null, 1)}

IL VIOLE CES RÈGLES — corrige UNIQUEMENT ces points, ne change rien d'autre :
${violationsBlock(violations)}

Renvoie le planning COMPLET corrigé au même format JSON.`;
    out = await call(repromptUser);
    sessions = materialize(out, args.input.weekStart);
    violations = checkWeekPlan(cfg, sessions, fixed);
  }

  // Filet mécanique si des erreurs persistent.
  const repairWarnings: string[] = [];
  if (violations.some((v) => v.severity === "error")) {
    const byId = new Map(sessions.map((s) => [s.id, s.title]));
    const { sessions: repaired, log } = mechanicalRepair(cfg, sessions, fixed);
    sessions = repaired;
    violations = checkWeekPlan(cfg, sessions, fixed);
    for (const l of log) {
      repairWarnings.push(`« ${byId.get(l.sessionId) || l.sessionId} » : ${l.action}.`);
    }
  }

  const unresolved = violations
    .filter((v) => v.severity === "error")
    .map((v) => `Non résolu : ${v.message}`);

  return {
    sessions,
    violations,
    warnings: [...out.warnings, ...repairWarnings, ...unresolved],
    messages: out.messages,
    attempts,
  };
}

/* ------------------------------ Retouche ------------------------------ */

/** Applique des opérations de retouche (par id) à un plan existant. Pur. */
export function applyOperations(
  sessions: PlanSession[],
  ops: RetouchOp[]
): PlanSession[] {
  let next = sessions.map((s) => ({ ...s }));
  let addSeq = 0;
  for (const op of ops) {
    if (op.op === "remove") {
      next = next.filter((s) => s.id !== op.sessionId);
    } else if (op.op === "move") {
      const idx = next.findIndex((s) => s.id === op.sessionId);
      if (idx === -1) continue;
      next[idx] = {
        ...next[idx],
        start: `${op.day}T${op.start}:00`,
        end: `${op.day}T${op.end}:00`,
      };
    } else {
      addSeq++;
      const s = op.session;
      next.push({
        id: `add${addSeq}-${s.category}`,
        title: s.title,
        category: s.category,
        activityId: s.activityId ?? undefined,
        placeId: s.placeId ?? undefined,
        start: `${s.day}T${s.start}:00`,
        end: `${s.day}T${s.end}:00`,
        exceptional: s.exceptional || undefined,
        rationale: s.rationale || undefined,
      });
    }
  }
  next.sort((a, b) => a.start.localeCompare(b.start));
  return next;
}

export type RetouchResult = {
  sessions: PlanSession[];
  operations: RetouchOp[];
  violations: Violation[];
  warnings: string[];
  messages: JosianeRetouchOut["messages"];
  attempts: number;
};

/**
 * Retouche ciblée d'un plan en place : opérations minimales par id,
 * re-validées par les guardrails (1 re-prompt en cas d'erreur, puis on
 * remonte les violations restantes — pas de réparation destructive sur
 * une retouche).
 */
export async function retouchWeek(
  baseCfg: LifeConfig,
  args: {
    weekStart: string;
    changeNote: string;
    sessions: PlanSession[];
    fixed: FixedItem[];
  },
  opts: PlacementOptions = {}
): Promise<RetouchResult> {
  const cfg = baseCfg;
  const system = buildJosianeRetouchSystem(cfg);
  const planBlock = args.sessions
    .map(
      (s) =>
        `- id=${s.id} | ${labelOf(s.start.slice(0, 10))} ${s.start.slice(11, 16)}-${s.end.slice(11, 16)} | ${s.title} [${s.category}]${s.placeId ? ` @ ${s.placeId}` : ""}`
    )
    .join("\n");
  const user = `SEMAINE :
${weekDates(args.weekStart).map(labelOf).map((l) => `- ${l}`).join("\n")}

ÉVÉNEMENTS FIXES (intouchables) :
${fixedBlock(args.fixed)}

PLANNING EN PLACE :
${planBlock || "(vide)"}

MODIFICATION DEMANDÉE :
"""${args.changeNote}"""

Renvoie les opérations minimales.`;

  const model = opts.model || MODELS.planner;
  let attempts = 0;
  const call = async (userContent: string): Promise<JosianeRetouchOut> => {
    attempts++;
    return callJson(JosianeRetouchOutSchema, {
      agent: "josiane-retouche",
      model,
      system,
      user: userContent,
      temperature: opts.temperature ?? 0.3,
      chat: opts.chat,
    });
  };

  let out = await call(user);
  let sessions = applyOperations(args.sessions, out.operations);
  let violations = checkWeekPlan(cfg, sessions, args.fixed);

  const before = new Set(checkWeekPlan(cfg, args.sessions, args.fixed).map(violationKey));
  const isNew = (v: Violation) => !before.has(violationKey(v));

  // Un seul re-prompt : seules les erreurs INTRODUITES par la retouche comptent
  // (un plan déjà imparfait ne bloque pas une retouche sans rapport).
  const newErrors = violations.filter((v) => v.severity === "error" && isNew(v));
  if (newErrors.length > 0) {
    const repromptUser = `${user}

TES OPÉRATIONS :
${JSON.stringify(out.operations, null, 1)}

Elles introduisent ces violations — corrige UNIQUEMENT ça :
${newErrors.map((v) => `- [${v.rule}] ${v.message}`).join("\n")}

Renvoie les opérations corrigées.`;
    out = await call(repromptUser);
    sessions = applyOperations(args.sessions, out.operations);
    violations = checkWeekPlan(cfg, sessions, args.fixed);
  }

  const unresolved = violations
    .filter((v) => v.severity === "error" && isNew(v))
    .map((v) => `Non résolu : ${v.message}`);

  return {
    sessions,
    operations: out.operations,
    violations,
    warnings: [...out.warnings, ...unresolved],
    messages: out.messages,
    attempts,
  };
}

function violationKey(v: Violation): string {
  return `${v.rule}|${v.message}`;
}

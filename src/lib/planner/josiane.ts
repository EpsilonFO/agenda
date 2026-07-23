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

import { MODELS } from "../openai";
import { addDays, toLocalIso } from "../dates";
import type { LifeConfig } from "./config";
import type {
  DjimoOut,
  EmilienOut,
  JannikOut,
  JosianeDecisionsOut,
  JosianeOut,
  JosianeRetouchOut,
  RetouchOp,
  WeekInput,
} from "./contracts";
import { JosianeDecisionsSchema, JosianeOutSchema, JosianeRetouchOutSchema } from "./contracts";
import { checkWeekPlan } from "./guardrails";
import { callJson, type ChatFn } from "./llm";
import {
  buildJosianeDecisionsSystem,
  buildJosianeRetouchSystem,
  buildJosianeSystem,
} from "./prompts";
import { mechanicalRepair } from "./repair";
import { solveWeek, type RejectedDecision, type SolverDecisions } from "./solver";
import type { FixedItem, PlanSession, Violation } from "./types";

const MAX_REPAIR_ROUNDS = 3;

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
  // Delos (3 demi-journées) est une RÈGLE : jamais surchargée à la semaine.
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

function normTitle(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * Filet : écarte toute session qui RECRÉE un événement fixe (titre proche +
 * chevauchement temporel). Josiane a l'interdiction de recréer les cours,
 * mais quand elle le fait quand même, c'est un doublon à jeter en silence —
 * pas un conflit à réparer en supprimant des choses importantes.
 */
export function dropFixedDuplicates(
  sessions: PlanSession[],
  fixed: FixedItem[]
): PlanSession[] {
  return sessions.filter((s) => {
    const st = normTitle(s.title);
    return !fixed.some((f) => {
      const ft = normTitle(f.title);
      const similar = st.includes(ft) || ft.includes(st);
      const overlaps = s.start < f.end && f.start < s.end;
      return similar && overlaps;
    });
  });
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
  maxRepairRounds?: number;
  /**
   * Moteur de placement :
   * - "decisions" (défaut v4) : Josiane tranche les choix qualitatifs, le
   *   solveur déterministe pose et valide ;
   * - "solver" : solveur seul, choix seedés au RNG, aucun LLM ;
   * - "llm" : ancien pipeline v2 (Josiane place tout + réparation).
   */
  engine?: "decisions" | "solver" | "llm";
  /** true = solveur déterministe seul, jamais de secours LLM (tests, mode strict). */
  solverOnly?: boolean;
  /** Trace de debug (voir trace.ts). */
  onEvent?: (agent: string, kind: "system" | "request" | "response" | "invalid" | "violations" | "repair" | "info", content: string) => void;
};

/**
 * Filet : une sortie DEMANDÉE avec un jour précis que Josiane a oubliée est
 * ajoutée d'office (heure demandée, sinon 20h-23h). Elle ne se négocie pas —
 * et la réparation par priorité écartera ce qui la gêne (Monumia d'abord).
 */
export function forceRequestedSorties(
  sessions: PlanSession[],
  requested: WeekInput["sortiesDatees"]
): { sessions: PlanSession[]; added: PlanSession[] } {
  const added: PlanSession[] = [];
  const sorties = sessions.filter((s) => s.category === "sortie");
  requested.forEach((r, i) => {
    if (!r.day) return; // sans jour, rien à forcer de façon déterministe
    const satisfied = sorties.some((s) => s.start.slice(0, 10) === r.day);
    if (satisfied) return;
    const start = r.start ?? "20:00";
    const [h, m] = start.split(":").map(Number);
    const endMin = r.end ? null : Math.min(h * 60 + m + 180, 23 * 60 + 59);
    const end =
      r.end ??
      `${String(Math.floor((endMin as number) / 60)).padStart(2, "0")}:${String((endMin as number) % 60).padStart(2, "0")}`;
    added.push({
      id: `forced-sortie-${i + 1}`,
      title: r.label,
      category: "sortie",
      start: `${r.day}T${start}:00`,
      end: `${r.day}T${end}:00`,
      rationale: "Sortie demandée, ajoutée automatiquement (oubliée par le planificateur).",
    });
  });
  return {
    sessions: [...sessions, ...added].sort((a, b) => a.start.localeCompare(b.start)),
    added,
  };
}

function violationsBlock(violations: Violation[]): string {
  return violations
    .filter((v) => v.severity === "error")
    .map((v) => `- [${v.rule}] ${v.message}`)
    .join("\n");
}

export type PlaceArgs = {
  input: WeekInput;
  fixed: FixedItem[];
  emilien: EmilienOut;
  jannik: JannikOut;
  djimo: DjimoOut;
};

/**
 * Place la semaine. Applique les overrides hebdo et matérialise les
 * indisponibilités, puis route vers le moteur choisi (voir opts.engine) :
 * - "decisions" (défaut) : Josiane décide, le solveur pose (v4) ;
 * - "solver" : solveur déterministe seul (RNG), zéro LLM ;
 * - "llm" : ancien pipeline v2 (Josiane place tout + réparation mécanique).
 */
export async function placeWeek(
  baseCfg: LifeConfig,
  args: PlaceArgs,
  opts: PlacementOptions = {}
): Promise<PlacementResult> {
  const cfg = applyOverrides(baseCfg, args.input);
  const fixed = [...args.fixed, ...indispoAsFixed(cfg, args.input)];
  const engine = opts.engine ?? (opts.solverOnly ? "solver" : "decisions");
  if (engine === "solver") {
    return solveWeek(cfg, { input: args.input, fixed, ...briefsOf(args) }, opts);
  }
  if (engine === "llm") {
    return placeWeekLLM(cfg, fixed, args, opts);
  }
  return placeWeekDecisions(cfg, fixed, args, opts);
}

/** Sous-ensemble « briefs » de PlaceArgs, tel que l'attend le solveur. */
function briefsOf(args: PlaceArgs) {
  return { emilien: args.emilien, jannik: args.jannik, djimo: args.djimo };
}

/** Convertit les décisions de Josiane (clé `day`) vers le solveur (clé `date`). */
function toSolverDecisions(out: JosianeDecisionsOut): SolverDecisions {
  return {
    delos: out.delos.map((d) => ({ date: d.day, gabarit: d.gabarit })),
    sport: out.sport.map((s) => ({ activityId: s.activityId, date: s.day, moment: s.moment })),
    sorties: out.sorties.map((s) => ({ label: s.label, date: s.day, start: s.start })),
  };
}

/** Rend les décisions rejetées lisibles pour un re-prompt ciblé. */
function rejectedBlock(rejected: RejectedDecision[]): string {
  return rejected.map((r) => `- [${r.kind}] ${r.ref} : ${r.reason}`).join("\n");
}

function decisionsUserContent(
  weekStart: string,
  fixed: FixedItem[],
  input: WeekInput,
  briefs: { emilien: EmilienOut; jannik: JannikOut; djimo: DjimoOut }
): string {
  const sortiesSansJour = input.sortiesDatees.filter((s) => !s.day);
  return `SEMAINE À ARBITRER (utilise ces dates exactes) :
${weekDates(weekStart).map(labelOf).map((l) => `- ${l}`).join("\n")}

ÉVÉNEMENTS DÉJÀ FIXÉS (le solveur les respecte ; tiens-en compte pour choisir les jours) :
${fixedBlock(fixed)}

BESOINS D'EMILIEN (travail — Delos à placer, préférence de répartition) :
${JSON.stringify(briefs.emilien, null, 1)}

SÉANCES DE JANNIK (sport — décide un jour + moment pour chacune) :
${JSON.stringify(briefs.jannik.seances, null, 1)}

SORTIES DE DJIMO (contexte) :
${JSON.stringify(briefs.djimo.sorties, null, 1)}

SORTIES DEMANDÉES SANS JOUR (choisis-en un soir pour chacune) :
${sortiesSansJour.length ? sortiesSansJour.map((s) => `- ${s.label}`).join("\n") : "(aucune)"}

DEMANDE DE LA SEMAINE :
- Voiture disponible : ${input.voitureDispo ? "oui" : "NON (trajets inter-zones en transports uniquement)"}
- Notes : """${input.notes || "(rien)"}"""

Rends tes décisions (jours Delos, jour+moment de chaque sport, soir des sorties sans jour).`;
}

/**
 * Moteur v4 : Josiane tranche les choix qualitatifs (jours Delos, sport,
 * sorties), le solveur déterministe pose et valide. Si le solveur rejette une
 * décision (infaisable), UN re-prompt ciblé lui demande de la revoir. Le repli
 * seedé du solveur garantit un planning légal quoi qu'il arrive.
 */
export async function placeWeekDecisions(
  cfg: LifeConfig,
  fixed: FixedItem[],
  args: PlaceArgs,
  opts: PlacementOptions = {}
): Promise<PlacementResult> {
  const system = buildJosianeDecisionsSystem(cfg);
  const user = decisionsUserContent(args.input.weekStart, fixed, args.input, args);
  const model = opts.model || MODELS.planner;

  let attempts = 0;
  const call = async (userContent: string): Promise<JosianeDecisionsOut> => {
    attempts++;
    return callJson(JosianeDecisionsSchema, {
      agent: "josiane-decisions",
      model,
      system,
      user: userContent,
      chat: opts.chat,
      onEvent: opts.onEvent,
    });
  };

  const solveArgs = { input: args.input, fixed, ...briefsOf(args) };
  const run = (out: JosianeDecisionsOut) =>
    solveWeek(cfg, { ...solveArgs, decisions: toSolverDecisions(out) }, opts);

  let out = await call(user);
  let result = run(out);
  opts.onEvent?.(
    "solveur",
    "violations",
    violationsBlock(result.violations) || "(aucune erreur)"
  );

  // Un seul re-prompt ciblé si des décisions étaient infaisables.
  if (result.rejected.length > 0) {
    opts.onEvent?.("solveur", "repair", `décisions rejetées :\n${rejectedBlock(result.rejected)}`);
    const repromptUser = `${user}

TES DÉCISIONS PRÉCÉDENTES :
${JSON.stringify({ delos: out.delos, sport: out.sport, sorties: out.sorties }, null, 1)}

CERTAINES SONT INFAISABLES — corrige UNIQUEMENT celles-ci, garde les autres :
${rejectedBlock(result.rejected)}

Renvoie l'ensemble de tes décisions corrigées, au même format.`;
    out = await call(repromptUser);
    result = run(out);
    opts.onEvent?.(
      "solveur",
      "violations",
      violationsBlock(result.violations) || "(aucune erreur)"
    );
  }

  const unresolvedRejects = result.rejected.map(
    (r) => `Choix non tenu (${r.kind} ${r.ref}) : ${r.reason} — repli automatique appliqué.`
  );
  return {
    sessions: result.sessions,
    violations: result.violations,
    warnings: [...result.warnings, ...unresolvedRejects, ...out.warnings],
    messages: out.messages,
    attempts,
  };
}

/**
 * L'implémentation LLM : place, guardrails, re-prompts ciblés, réparation
 * mécanique. `cfg` est déjà surchargée, `fixed` inclut déjà les indisponibilités.
 */
export async function placeWeekLLM(
  cfg: LifeConfig,
  fixed: FixedItem[],
  args: PlaceArgs,
  opts: PlacementOptions = {}
): Promise<PlacementResult> {
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
      chat: opts.chat,
      onEvent: opts.onEvent,
    });
  };

  // Une session Delos est toujours au bureau Delos : lieu auto-rempli si omis.
  const normalize = (list: PlanSession[]): PlanSession[] =>
    dropFixedDuplicates(list, fixed).map((s) =>
      s.category === "delos" && !s.placeId
        ? { ...s, placeId: cfg.work.delos.placeId }
        : s
    );
  const check = (list: PlanSession[]) =>
    checkWeekPlan(cfg, list, fixed, { requestedSorties: args.input.sortiesDatees });

  let out = await call(user);
  let sessions = normalize(materialize(out, args.input.weekStart));
  let violations = check(sessions);
  opts.onEvent?.("guardrails", "violations", violationsBlock(violations) || "(aucune erreur)");

  // Re-prompts ciblés : uniquement les erreurs, planning actuel joint.
  for (let round = 0; round < maxRounds; round++) {
    if (!violations.some((v) => v.severity === "error")) break;
    const repromptUser = `${user}

TON PLANNING PRÉCÉDENT :
${JSON.stringify(out.sessions, null, 1)}

IL VIOLE CES RÈGLES — corrige UNIQUEMENT ces points, ne change rien d'autre :
${violationsBlock(violations)}

Rappels pour corriger : MONUMIA est la variable d'ajustement — c'est lui qu'on réduit ou déplace en cas de conflit ou de dépassement. Les demi-journées Delos et les sorties demandées ne sautent JAMAIS. Ne recrée AUCUN événement fixe (cours).
Renvoie le planning COMPLET corrigé au même format JSON.`;
    out = await call(repromptUser);
    sessions = normalize(materialize(out, args.input.weekStart));
    violations = check(sessions);
    opts.onEvent?.("guardrails", "violations", violationsBlock(violations) || "(aucune erreur)");
  }

  // Filet mécanique si des erreurs persistent.
  const repairWarnings: string[] = [];
  if (violations.some((v) => v.severity === "error")) {
    // Une sortie demandée oubliée s'ajoute d'office AVANT la réparation :
    // la priorité (sortie > … > monumia) écarte ce qui la gêne.
    const forced = forceRequestedSorties(sessions, args.input.sortiesDatees);
    sessions = forced.sessions;
    for (const a of forced.added) {
      repairWarnings.push(`« ${a.title} » ajoutée automatiquement (le planificateur l'avait oubliée).`);
      opts.onEvent?.("repair", "repair", `sortie forcée : ${a.title} ${a.start}`);
    }

    const byId = new Map(sessions.map((s) => [s.id, s.title]));
    const { sessions: repaired, log } = mechanicalRepair(cfg, sessions, fixed);
    sessions = repaired;
    violations = check(sessions);
    for (const l of log) {
      repairWarnings.push(`« ${byId.get(l.sessionId) || l.sessionId} » : ${l.action}.`);
      opts.onEvent?.("repair", "repair", `${byId.get(l.sessionId) || l.sessionId} : ${l.action}`);
    }
    opts.onEvent?.("guardrails", "violations", violationsBlock(violations) || "(aucune erreur après réparation)");
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
  /** Erreurs INTRODUITES par la retouche et non résolues — ne pas auto-appliquer. */
  blockingErrors: string[];
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

  const blockingErrors = violations
    .filter((v) => v.severity === "error" && isNew(v))
    .map((v) => v.message);

  return {
    sessions,
    operations: out.operations,
    violations,
    warnings: [...out.warnings, ...blockingErrors.map((m) => `Non résolu : ${m}`)],
    blockingErrors,
    messages: out.messages,
    attempts,
  };
}

function violationKey(v: Violation): string {
  return `${v.rule}|${v.message}`;
}

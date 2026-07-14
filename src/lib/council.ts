/**
 * Le Conseil — orchestrateur des 5 agents nommés.
 *
 * Pipeline en étoile autour de Josiane :
 *   { Emilien, Jannik, Djimo }  →  Josiane  →  [1 tour de négociation]  →  Simone
 *
 * Emilien (travail), Jannik (sport) et Djimo (loisir) émettent des DEMANDES.
 * Josiane (agenda) les intègre, arbitre et place concrètement chaque chose.
 * Si elle ne peut pas tout satisfaire, elle renvoie un « pushback » à l'émetteur
 * concerné, qui révise une fois. Enfin Simone (cuisine) lit la semaine planifiée
 * et propose repas + liste de courses.
 *
 * Reprend et généralise l'ancien planner.ts (contexte, matérialisation, trajets).
 */

import {
  listEvents,
  listActivities,
  listPlaces,
  listTravelTimes,
  listMemory,
  listWorkStreams,
  listTasks,
  getProfile,
} from "./store";
import { MODELS, mistralChat, parseJsonLoose } from "./mistral";
import {
  EMILIEN_SYSTEM,
  JANNIK_SYSTEM,
  DJIMO_SYSTEM,
  JOSIANE_SYSTEM,
  JOSIANE_RETOUCH_SYSTEM,
  SIMONE_SYSTEM,
} from "./personas";
import {
  startOfWeek,
  addDays,
  parseFlexibleDate,
  datesForWeekday,
  formatFullDate,
  formatTime,
  toLocalIso,
  parseIso,
} from "./dates";
import type {
  EventItem,
  Activity,
  Place,
  TravelTime,
  WorkStream,
  Task,
  PlannedSession,
  WorkoutPlan,
  MealPlan,
  GroceryList,
  CouncilMessage,
  AgentName,
  WeekPlan,
} from "./types";

/* --------------------- Recherche de trajet (symétrique) -------------- */

function travelBetween(
  travels: TravelTime[],
  fromId: string,
  toId: string,
  preferMode?: string
): { minutes: number; mode: string } | null {
  const candidates = travels.filter(
    (t) =>
      (t.fromId === fromId && t.toId === toId) ||
      (t.fromId === toId && t.toId === fromId)
  );
  if (candidates.length === 0) return null;
  if (preferMode) {
    const m = candidates.find((c) => c.mode === preferMode);
    if (m) return { minutes: m.minutes, mode: m.mode };
  }
  const fastest = candidates.reduce((a, b) => (b.minutes < a.minutes ? b : a));
  return { minutes: fastest.minutes, mode: fastest.mode };
}

/* --------------------------- Contexte semaine ------------------------ */

type PlanContext = {
  weekStart: Date;
  weekDays: Date[];
  weekEvents: EventItem[];
  recentSport: EventItem[];
  activities: Activity[];
  places: Place[];
  travels: TravelTime[];
  workStreams: WorkStream[];
  tasks: Task[];
  memory: string[];
  profile: Awaited<ReturnType<typeof getProfile>>;
};

async function assembleContext(weekStartInput?: string): Promise<PlanContext> {
  const weekStart = startOfWeek(parseFlexibleDate(weekStartInput));
  const weekEnd = addDays(weekStart, 7);
  const recentFrom = addDays(weekStart, -7);

  const [allEvents, activities, places, travels, workStreams, tasks, memory, profile] =
    await Promise.all([
      listEvents(),
      listActivities(),
      listPlaces(),
      listTravelTimes(),
      listWorkStreams(),
      listTasks(),
      listMemory(),
      getProfile(),
    ]);

  const inRange = (iso: string, from: Date, to: Date) => {
    const d = parseIso(iso);
    return d >= from && d < to;
  };

  // Les événements issus d'un plan précédent (source "plan") ne sont PAS des
  // contraintes fixes : ce sont justement ce que le Conseil régénère. Seuls les
  // cours et événements créés à la main sont des contraintes dures.
  const fixedEvents = allEvents.filter((e) => e.source !== "plan");
  const weekEvents = fixedEvents.filter((e) => inRange(e.start, weekStart, weekEnd));
  const recentSport = fixedEvents.filter(
    (e) =>
      (e.category || "").toLowerCase() === "sport" &&
      inRange(e.start, recentFrom, weekStart)
  );

  return {
    weekStart,
    weekDays: Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    weekEvents,
    recentSport,
    activities,
    places,
    travels,
    workStreams,
    tasks: tasks.filter((t) => !t.done),
    memory: memory.map((m) => m.content),
    profile,
  };
}

/* ----------------------- Rendu du contexte (texte) ------------------- */

function placeName(places: Place[], id?: string): string | undefined {
  if (!id) return undefined;
  return places.find((p) => p.id === id)?.name;
}

function resolvePlaceId(places: Place[], name?: string): string | undefined {
  if (!name) return undefined;
  const n = name.trim().toLowerCase();
  const exact = places.find((p) => p.name.toLowerCase() === n);
  if (exact) return exact.id;
  const partial = places.find(
    (p) => p.name.toLowerCase().includes(n) || n.includes(p.name.toLowerCase())
  );
  return partial?.id;
}

function resolveActivityId(activities: Activity[], name?: string): string | undefined {
  if (!name) return undefined;
  const n = name.trim().toLowerCase();
  const exact = activities.find((a) => a.name.toLowerCase() === n);
  if (exact) return exact.id;
  const partial = activities.find(
    (a) => a.name.toLowerCase().includes(n) || n.includes(a.name.toLowerCase())
  );
  return partial?.id;
}

function daysBlock(ctx: PlanContext): string {
  return ctx.weekDays.map((d) => `- ${formatFullDate(d)}`).join("\n");
}

function eventsBlock(ctx: PlanContext): string {
  if (ctx.weekEvents.length === 0) return "(aucun — semaine libre)";
  return ctx.weekEvents
    .map((e) => {
      const s = parseIso(e.start);
      const en = parseIso(e.end);
      const loc = e.location ? ` @ ${e.location}` : "";
      return `- ${formatFullDate(s)} ${formatTime(s)}–${formatTime(en)} : ${
        e.title
      }${loc} [${e.category || "?"}]`;
    })
    .join("\n");
}

function placesTravelBlock(ctx: PlanContext): string {
  const { places, travels, profile } = ctx;
  const placesTxt =
    places.length > 0
      ? places
          .map(
            (p) =>
              `- ${p.name}${p.type ? ` (${p.type})` : ""}${
                p.isHome ? " — DOMICILE" : ""
              }`
          )
          .join("\n")
      : "(aucun lieu enregistré)";
  const travelsTxt =
    travels.length > 0
      ? travels
          .map((t) => {
            const from = placeName(places, t.fromId) || "?";
            const to = placeName(places, t.toId) || "?";
            return `- ${from} ↔ ${to} : ${t.minutes} min (${t.mode})`;
          })
          .join("\n")
      : "(aucun temps de trajet enregistré)";
  const home = placeName(places, profile.homePlaceId) || "(non défini)";
  return `LIEUX :\n${placesTxt}\nDomicile de départ : ${home}\n\nTEMPS DE TRAJET (symétriques) :\n${travelsTxt}\n\nTRANSPORT — modes possédés par défaut : ${
    profile.transportModes.join(", ") || "à pied"
  }. Voiture par défaut : ${profile.carDefault ? "oui" : "non"}.`;
}

function workBlock(ctx: PlanContext): string {
  const streams =
    ctx.workStreams.length > 0
      ? ctx.workStreams
          .map(
            (w) =>
              `- ${w.name} [${w.kind}]${
                w.weeklyHoursTarget ? ` — cible ${w.weeklyHoursTarget}h/sem` : ""
              }${w.placeId ? ` @ ${placeName(ctx.places, w.placeId)}` : ""}${
                w.notes ? ` — ${w.notes}` : ""
              }`
          )
          .join("\n")
      : "(aucune couche de travail définie)";
  const tasks =
    ctx.tasks.length > 0
      ? ctx.tasks
          .map(
            (t) =>
              `- ${t.title} — à rendre le ${t.dueDate}, ~${t.estimatedHours}h de travail${
                t.streamId
                  ? ` (${ctx.workStreams.find((w) => w.id === t.streamId)?.name || "?"})`
                  : ""
              }`
          )
          .join("\n")
      : "(aucun TP / échéance en attente)";
  return `COUCHES DE TRAVAIL :\n${streams}\n\nTP / ÉCHÉANCES À RENDRE :\n${tasks}`;
}

function sportBlock(ctx: PlanContext): string {
  const activities =
    ctx.activities.filter((a) => a.sport).length > 0
      ? ctx.activities
          .filter((a) => a.sport)
          .map((a) => {
            const where = placeName(ctx.places, a.placeId);
            const s = a.sport!;
            const hours = a.openingHours
              ? `, ouvert ${a.openingHours.open}–${a.openingHours.close}`
              : "";
            return `- ${a.name} (${a.durationMin} min${
              where ? `, @ ${where}` : ""
            }${hours}) | intensité ${s.intensity}, repos ≥ ${s.minRestHoursAfter}h${
              s.muscleGroups?.length ? `, muscles: ${s.muscleGroups.join(", ")}` : ""
            }${a.perWeek ? ` | ${a.perWeek}×/sem` : ""}`;
          })
          .join("\n")
      : "(aucune activité sportive définie)";
  const recent =
    ctx.recentSport.length > 0
      ? ctx.recentSport
          .map((e) => `- ${formatFullDate(parseIso(e.start))} : ${e.title}`)
          .join("\n")
      : "(aucune séance de sport les 7 derniers jours)";
  return `ACTIVITÉS SPORTIVES :\n${activities}\n\nSÉANCES RÉCENTES (récupération) :\n${recent}`;
}

function leisureBlock(ctx: PlanContext): string {
  const activities =
    ctx.activities.filter((a) => !a.sport).length > 0
      ? ctx.activities
          .filter((a) => !a.sport)
          .map((a) => {
            const where = placeName(ctx.places, a.placeId);
            return `- ${a.name} (${a.durationMin} min${where ? `, @ ${where}` : ""})${
              a.perWeek ? ` | ${a.perWeek}×/sem` : ""
            }${a.preferredWindows?.length ? ` | préf: ${a.preferredWindows.join(", ")}` : ""}`;
          })
          .join("\n")
      : "(aucune activité loisir définie)";
  return `ACTIVITÉS LOISIR / PERSO :\n${activities}`;
}

function openingHoursBlock(ctx: PlanContext): string {
  const withHours = ctx.activities.filter((a) => a.openingHours);
  if (withHours.length === 0) return "";
  const lines = withHours
    .map((a) => `- ${a.name} : ${a.openingHours!.open}–${a.openingHours!.close}`)
    .join("\n");
  return `HEURES D'OUVERTURE (ne place JAMAIS une séance hors de ces plages ; la séance doit commencer ET finir dans la plage) :\n${lines}`;
}

function memoryBlock(ctx: PlanContext): string {
  return `PRÉFÉRENCES ENREGISTRÉES :\n${
    ctx.memory.length ? ctx.memory.map((m) => `- ${m}`).join("\n") : "(aucune)"
  }`;
}

/* --------------------- Appel générique d'une persona ----------------- */

async function callPersona<T>(
  model: string,
  system: string,
  userContent: string
): Promise<T | null> {
  const message = await mistralChat({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
    temperature: 0.4,
    json: true,
  });
  return parseJsonLoose<T>(String(message.content || ""));
}

type RawMessage = { to?: string; text?: string };

const EMITTER_SET: AgentName[] = ["emilien", "jannik", "djimo"];

/**
 * Applique la topologie de communication du Conseil :
 *  - les émetteurs (Emilien/Jannik/Djimo) ne parlent QU'À Josiane ;
 *  - Josiane répond aux émetteurs ;
 *  - Simone travaille dans son coin : elle n'émet aucun message.
 */
function collectMessages(
  from: AgentName,
  round: number,
  raw?: RawMessage[]
): CouncilMessage[] {
  if (from === "simone" || !Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && m.text)
    .map((m) => {
      let to = (m.to || "").toLowerCase() as AgentName;
      if (EMITTER_SET.includes(from)) {
        // Un émetteur ne s'adresse qu'à Josiane, quoi qu'il ait écrit.
        to = "josiane";
      } else if (from === "josiane" && !EMITTER_SET.includes(to)) {
        // Josiane ne s'adresse qu'aux émetteurs.
        to = "josiane";
      }
      return { from, to, text: String(m.text), round };
    })
    .filter((m) => m.from !== m.to);
}

/* ---------------------------- Les émetteurs -------------------------- */

type EmilienOut = {
  demands?: unknown[];
  summary?: string;
  messages?: RawMessage[];
};
type JannikSession = {
  activity?: string;
  placeName?: string;
  durationMin?: number;
  intensity?: "low" | "moderate" | "high";
  minRestHours?: number;
  muscleGroups?: string[];
  preferredWindows?: string[];
  exercises?: string[];
  tips?: string[];
  note?: string;
};
type JannikOut = {
  sessions?: JannikSession[];
  summary?: string;
  messages?: RawMessage[];
};
type DjimoOut = {
  wishes?: unknown[];
  summary?: string;
  messages?: RawMessage[];
};

async function runEmilien(
  ctx: PlanContext,
  request: string,
  feedback?: string
): Promise<EmilienOut> {
  const content = `SEMAINE À PLANIFIER :\n${daysBlock(ctx)}\n\nÉVÉNEMENTS DÉJÀ FIXÉS (dont les cours du master) :\n${eventsBlock(
    ctx
  )}\n\n${workBlock(ctx)}\n\n${memoryBlock(ctx)}\n\nDEMANDE DE L'UTILISATEUR :\n"""${request}"""${
    feedback ? `\n\nRETOUR DE JOSIANE (ajuste tes demandes en conséquence) :\n${feedback}` : ""
  }`;
  return (await callPersona<EmilienOut>(MODELS.work, EMILIEN_SYSTEM, content)) || {};
}

async function runJannik(
  ctx: PlanContext,
  request: string,
  feedback?: string
): Promise<JannikOut> {
  const content = `SEMAINE À PLANIFIER :\n${daysBlock(ctx)}\n\n${sportBlock(
    ctx
  )}\n\n${memoryBlock(ctx)}\n\nDEMANDE DE L'UTILISATEUR :\n"""${request}"""${
    feedback ? `\n\nRETOUR DE JOSIANE (ajuste tes séances en conséquence) :\n${feedback}` : ""
  }`;
  return (await callPersona<JannikOut>(MODELS.coach, JANNIK_SYSTEM, content)) || {};
}

async function runDjimo(
  ctx: PlanContext,
  request: string,
  feedback?: string
): Promise<DjimoOut> {
  const content = `SEMAINE À PLANIFIER :\n${daysBlock(ctx)}\n\n${leisureBlock(
    ctx
  )}\n\n${memoryBlock(ctx)}\n\nDEMANDE DE L'UTILISATEUR :\n"""${request}"""${
    feedback ? `\n\nRETOUR DE JOSIANE (ajuste tes souhaits en conséquence) :\n${feedback}` : ""
  }`;
  return (await callPersona<DjimoOut>(MODELS.leisure, DJIMO_SYSTEM, content)) || {};
}

/* ---------------------------- Josiane -------------------------------- */

type RawSession = {
  title?: string;
  activity?: string;
  place?: string;
  weekday?: string;
  start?: string;
  end?: string;
  transportMode?: string;
  category?: string;
  rationale?: string;
};
type JosianeOut = {
  sessions?: RawSession[];
  warnings?: string[];
  messages?: RawMessage[];
};

function briefsBlock(
  emilien: EmilienOut,
  jannik: JannikOut,
  djimo: DjimoOut
): string {
  return `DEMANDES D'EMILIEN (travail) :\n${JSON.stringify(
    emilien.demands || [],
    null,
    2
  )}\nRésumé : ${emilien.summary || "—"}\n\nSÉANCES VOULUES PAR JANNIK (sport) :\n${JSON.stringify(
    (jannik.sessions || []).map((s) => ({
      activity: s.activity,
      placeName: s.placeName,
      durationMin: s.durationMin,
      intensity: s.intensity,
      minRestHours: s.minRestHours,
      preferredWindows: s.preferredWindows,
      note: s.note,
    })),
    null,
    2
  )}\nRésumé : ${jannik.summary || "—"}\n\nSOUHAITS DE DJIMO (loisir) :\n${JSON.stringify(
    djimo.wishes || [],
    null,
    2
  )}\nRésumé : ${djimo.summary || "—"}`;
}

function currentPlanBlock(sessions: PlannedSession[]): string {
  if (sessions.length === 0) return "(aucun)";
  return sessions
    .map((s) => {
      const d = parseIso(s.start);
      return `- ${formatFullDate(d)} ${formatTime(d)}–${formatTime(
        parseIso(s.end)
      )} : ${s.title}${s.placeName ? ` @ ${s.placeName}` : ""} [${s.category || "?"}]`;
    })
    .join("\n");
}

async function runJosiane(
  ctx: PlanContext,
  request: string,
  emilien: EmilienOut,
  jannik: JannikOut,
  djimo: DjimoOut
): Promise<JosianeOut> {
  const content = `SEMAINE À PLANIFIER (utilise ces dates telles quelles) :\n${daysBlock(
    ctx
  )}\n\nÉVÉNEMENTS DÉJÀ FIXÉS (CONTRAINTES DURES, ne pas déplacer) :\n${eventsBlock(
    ctx
  )}\n\n${placesTravelBlock(ctx)}\n\n${openingHoursBlock(ctx)}\n\n${briefsBlock(
    emilien,
    jannik,
    djimo
  )}\n\n${memoryBlock(ctx)}\n\nDEMANDE DE L'UTILISATEUR :\n"""${request}"""`;
  return (await callPersona<JosianeOut>(MODELS.planner, JOSIANE_SYSTEM, content)) || {};
}

/* --------------------- Josiane — retouche par opérations ------------- */

type Operation = {
  op?: "move" | "add" | "remove";
  match?: string;
  title?: string;
  activity?: string;
  place?: string;
  weekday?: string;
  start?: string;
  end?: string;
  transportMode?: string;
  category?: string;
  rationale?: string;
};
type JosianeRetouchOut = {
  operations?: Operation[];
  warnings?: string[];
  messages?: RawMessage[];
};

async function runJosianeRetouch(
  ctx: PlanContext,
  currentSessions: PlannedSession[],
  changeNote: string
): Promise<JosianeRetouchOut> {
  const content = `SEMAINE (dates exactes) :\n${daysBlock(
    ctx
  )}\n\nÉVÉNEMENTS FIXES (intouchables) :\n${eventsBlock(
    ctx
  )}\n\n${placesTravelBlock(ctx)}\n\n${openingHoursBlock(
    ctx
  )}\n\nPLANNING ACTUEL DÉJÀ VALIDÉ :\n${currentPlanBlock(
    currentSessions
  )}\n\nMODIFICATION DEMANDÉE :\n"""${changeNote}"""\n\nRenvoie uniquement les opérations minimales à appliquer.`;
  return (
    (await callPersona<JosianeRetouchOut>(
      MODELS.planner,
      JOSIANE_RETOUCH_SYSTEM,
      content
    )) || {}
  );
}

/** Applique de façon déterministe les opérations de Josiane au planning existant. */
function applyOperations(
  ctx: PlanContext,
  base: PlannedSession[],
  operations: Operation[]
): PlannedSession[] {
  let sessions = base.map((s) => ({ ...s }));

  const findIdx = (match?: string): number => {
    const m = norm(match);
    if (!m) return -1;
    return sessions.findIndex(
      (s) => norm(s.title).includes(m) || m.includes(norm(s.title))
    );
  };

  for (const op of operations) {
    if (op.op === "remove") {
      const idx = findIdx(op.match);
      if (idx !== -1) sessions.splice(idx, 1);
    } else if (op.op === "move") {
      const idx = findIdx(op.match);
      if (idx === -1) continue;
      const [moved] = materialize(ctx, [
        {
          title: sessions[idx].title,
          activity: sessions[idx].title,
          place: sessions[idx].placeName,
          weekday: op.weekday,
          start: op.start,
          end: op.end,
          transportMode: op.transportMode || sessions[idx].transportMode,
          category: sessions[idx].category,
          rationale: op.rationale || sessions[idx].rationale,
        },
      ]);
      if (moved) sessions[idx] = { ...sessions[idx], ...moved };
    } else if (op.op === "add") {
      const [added] = materialize(ctx, [
        {
          title: op.title || op.activity,
          activity: op.activity,
          place: op.place,
          weekday: op.weekday,
          start: op.start,
          end: op.end,
          transportMode: op.transportMode,
          category: op.category,
          rationale: op.rationale,
        },
      ]);
      if (added) sessions.push(added);
    }
  }

  sessions = dropFixedDuplicates(ctx, sessions);
  sessions = enforceOpeningHours(ctx, sessions);
  sessions.sort((a, b) => a.start.localeCompare(b.start));
  enrichTravel(ctx, sessions);
  return sessions;
}

/* ---------------------- Matérialisation des séances ------------------ */

function materialize(ctx: PlanContext, raw: RawSession[]): PlannedSession[] {
  const sessions: PlannedSession[] = [];
  for (const s of raw) {
    if (!s.weekday || !s.start || !s.end) continue;
    const dayMatches = datesForWeekday(s.weekday, ctx.weekStart, undefined, 1);
    if (dayMatches.length === 0) continue;
    const day = dayMatches[0];
    if (day >= addDays(ctx.weekStart, 7)) continue;

    const [sh, sm] = s.start.split(":").map(Number);
    const [eh, em] = s.end.split(":").map(Number);
    if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) continue;

    const start = new Date(day);
    start.setHours(sh, sm, 0, 0);
    const end = new Date(day);
    end.setHours(eh, em, 0, 0);

    const placeId = resolvePlaceId(ctx.places, s.place);
    sessions.push({
      activityId: resolveActivityId(ctx.activities, s.activity),
      title: s.title?.trim() || s.activity?.trim() || "Séance",
      placeId,
      placeName: placeName(ctx.places, placeId),
      start: toLocalIso(start),
      end: toLocalIso(end),
      category: s.category?.trim(),
      transportMode: s.transportMode?.trim(),
      rationale: s.rationale?.trim(),
    });
  }
  sessions.sort((a, b) => a.start.localeCompare(b.start));
  return sessions;
}

/**
 * Filet de sécurité : écarte toute séance que Josiane aurait recréée alors
 * qu'elle correspond à un événement DÉJÀ fixé (même début + titre proche).
 * Les cours et événements fixes ne doivent jamais être dupliqués.
 */
function dropFixedDuplicates(
  ctx: PlanContext,
  sessions: PlannedSession[]
): PlannedSession[] {
  const fixed = ctx.weekEvents.map((e) => ({
    start: e.start,
    title: norm(e.title),
  }));
  return sessions.filter((s) => {
    const st = s.start;
    const t = norm(s.title);
    return !fixed.some(
      (f) =>
        f.start === st &&
        (f.title === t || f.title.includes(t) || t.includes(f.title))
    );
  });
}

/**
 * Filet déterministe : recale toute séance hors des heures d'ouverture de son
 * activité (salle, piscine…) pour qu'elle commence ET finisse dans la plage.
 * On décale la séance (en gardant sa durée) plutôt que de la supprimer.
 */
function enforceOpeningHours(
  ctx: PlanContext,
  sessions: PlannedSession[]
): PlannedSession[] {
  const byId = new Map(ctx.activities.map((a) => [a.id, a]));
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  return sessions.map((s) => {
    const act =
      (s.activityId && byId.get(s.activityId)) ||
      ctx.activities.find(
        (a) =>
          a.openingHours &&
          (norm(s.title).includes(norm(a.name)) ||
            norm(a.name).includes(norm(s.title)))
      );
    if (!act?.openingHours) return s;
    const open = toMin(act.openingHours.open);
    const close = toMin(act.openingHours.close);
    if (close <= open) return s;

    const start = parseIso(s.start);
    const end = parseIso(s.end);
    const sMin = start.getHours() * 60 + start.getMinutes();
    const eMin = end.getHours() * 60 + end.getMinutes();
    const dur = eMin - sMin;
    if (dur <= 0) return s;

    let ns = sMin;
    let ne = eMin;
    if (dur >= close - open) {
      ns = open;
      ne = close;
    } else {
      if (ns < open) {
        ns = open;
        ne = ns + dur;
      }
      if (ne > close) {
        ne = close;
        ns = ne - dur;
      }
    }
    if (ns === sMin && ne === eMin) return s;
    const day = s.start.slice(0, 10);
    const mk = (m: number) =>
      `${day}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(
        m % 60
      ).padStart(2, "0")}:00`;
    return { ...s, start: mk(ns), end: mk(ne) };
  });
}

/** Recalcule les temps de trajet de façon déterministe depuis la matrice. */
function enrichTravel(ctx: PlanContext, sessions: PlannedSession[]): void {
  const home = ctx.profile.homePlaceId;
  const byDay = new Map<string, PlannedSession[]>();
  for (const s of sessions) {
    const day = s.start.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(s);
  }
  for (const list of byDay.values()) {
    let prevPlace = home;
    for (const s of list) {
      if (s.placeId && prevPlace && s.placeId !== prevPlace) {
        const t = travelBetween(ctx.travels, prevPlace, s.placeId, s.transportMode);
        if (t) {
          s.travelFromPrevMin = t.minutes;
          if (!s.transportMode) s.transportMode = t.mode;
        }
      }
      if (s.placeId) prevPlace = s.placeId;
    }
  }
}

/* --------- Rapprochement séances sport ↔ détails de Jannik ---------- */

function norm(s?: string): string {
  return (s || "").trim().toLowerCase();
}

/**
 * Associe à chaque séance de sport planifiée par Josiane les exercices et
 * conseils émis par Jannik (rapprochement par activité/titre, best-effort).
 */
function buildWorkouts(
  sessions: PlannedSession[],
  jannik: JannikOut
): WorkoutPlan[] {
  const sport = sessions.filter((s) => norm(s.category) === "sport");
  const jSessions = jannik.sessions || [];
  const used = new Set<number>();
  const workouts: WorkoutPlan[] = [];

  for (const s of sport) {
    let matchIdx = jSessions.findIndex(
      (j, i) =>
        !used.has(i) &&
        (norm(j.activity) === norm(s.title) ||
          (norm(j.activity) && norm(s.title).includes(norm(j.activity))) ||
          (norm(j.activity) && norm(j.activity).includes(norm(s.title))))
    );
    if (matchIdx === -1) {
      matchIdx = jSessions.findIndex((_, i) => !used.has(i));
    }
    const j = matchIdx !== -1 ? jSessions[matchIdx] : undefined;
    if (matchIdx !== -1) used.add(matchIdx);
    workouts.push({
      sessionStart: s.start,
      title: s.title,
      intensity: j?.intensity,
      exercises: j?.exercises || [],
      tips: j?.tips || [],
    });
  }
  return workouts;
}

/* ------------------------------ Simone ------------------------------- */

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Filet déterministe : retire des repas tout aliment que l'utilisateur n'aime
 * pas (ingrédients + étapes qui le mentionnent). On épargne les dérivés en
 * "huile" (ex: huile d'olive reste acceptable même si "olives" est banni).
 */
function scrubDisliked(meals: MealPlan[], disliked?: string[]): MealPlan[] {
  const terms = (disliked || []).map(stripAccents).filter(Boolean);
  if (terms.length === 0) return meals;
  const hits = (text: string) => {
    // On neutralise d'abord "huile d'olive" : c'est un condiment acceptable
    // même quand "olives" est banni.
    const t = stripAccents(text).replace(/huile d['e ]?olives?/g, " ");
    return terms.some((term) => {
      const re = new RegExp(`\\b${term.replace(/s$/, "")}s?\\b`);
      return re.test(t);
    });
  };
  return meals.map((m) => ({
    ...m,
    ingredients: m.ingredients.filter((i) => !hits(i.name)),
    steps: m.steps.filter((s) => !hits(s)),
  }));
}

type SimoneOut = {
  meals?: MealPlan[];
  groceries?: GroceryList;
  summary?: string;
  messages?: RawMessage[];
};

function scheduledBlock(
  sessions: PlannedSession[],
  workouts: WorkoutPlan[]
): string {
  if (sessions.length === 0) return "(semaine vide)";
  const intensityByStart = new Map(workouts.map((w) => [w.sessionStart, w.intensity]));
  return sessions
    .map((s) => {
      const d = parseIso(s.start);
      const intensity = intensityByStart.get(s.start);
      return `- ${formatFullDate(d)} ${formatTime(d)}–${formatTime(
        parseIso(s.end)
      )} : ${s.title} [${s.category || "?"}${
        intensity ? `, intensité ${intensity}` : ""
      }]`;
    })
    .join("\n");
}

async function runSimone(
  ctx: PlanContext,
  sessions: PlannedSession[],
  workouts: WorkoutPlan[],
  request: string
): Promise<SimoneOut> {
  const disliked = ctx.profile.dislikedFoods?.length
    ? ctx.profile.dislikedFoods.join(", ")
    : "(aucun)";
  const content = `SEMAINE DÉJÀ PLANIFIÉE PAR JOSIANE :\n${daysBlock(
    ctx
  )}\n\nCOURS & ÉVÉNEMENTS FIXES (repère les jours avec COURS LE MATIN → déjeuner au CROUS, pas de déjeuner à prévoir ; un jour SANS cours le matin = déjeuner à la maison) :\n${eventsBlock(
    ctx
  )}\n\nEMPLOI DU TEMPS PLACÉ (charge & créneaux libres) :\n${scheduledBlock(
    sessions,
    workouts
  )}\n\n${memoryBlock(
    ctx
  )}\n\nALIMENTS À ÉVITER (ne les utilise jamais) : ${disliked}\n\nCONTRAINTES DE LA SEMAINE (repère notamment les jours chez les parents → aucun repas à prévoir) :\n"""${request}"""\n\nProduis les repas à préparer à la maison : petit-déj + déjeuner + dîner chaque jour à la maison, en n'omettant QUE les repas exclus (parents, ou déjeuner les jours à cours le matin). Plus une liste de courses consolidée.`;
  return (await callPersona<SimoneOut>(MODELS.chef, SIMONE_SYSTEM, content)) || {};
}

/* --------------------------- Orchestration --------------------------- */

/** Sous-ensemble d'agents à (re)faire tourner. Défaut : tous. */
export type CouncilScope = {
  emilien?: boolean;
  jannik?: boolean;
  djimo?: boolean;
  josiane?: boolean;
  simone?: boolean;
};

/**
 * Pipeline complet du Conseil. Renvoie un WeekPlan proposé (jamais écrit).
 * `previous` permet une retouche incrémentale : les stages hors `scope`
 * réutilisent les résultats du plan précédent.
 */
export async function proposeWeekPlan(
  request: string,
  weekStartInput?: string,
  opts?: { scope?: CouncilScope; previous?: WeekPlan | null; changeNote?: string }
): Promise<WeekPlan> {
  const ctx = await assembleContext(weekStartInput);
  const prev = opts?.previous || null;
  const isRetouch = Boolean(prev && opts?.changeNote);
  return isRetouch
    ? retouchWeekPlan(ctx, prev!, String(opts!.changeNote), opts?.scope)
    : fullWeekPlan(ctx, request);
}

/* -------- Plan complet : les 5 agents délibèrent depuis zéro -------- */

async function fullWeekPlan(
  ctx: PlanContext,
  request: string
): Promise<WeekPlan> {
  const transcript: CouncilMessage[] = [];

  // --- Tour 0 : les émetteurs parlent (en parallèle) ---
  const [emilien, jannik, djimo] = await Promise.all([
    runEmilien(ctx, request),
    runJannik(ctx, request),
    runDjimo(ctx, request),
  ]);
  transcript.push(...collectMessages("emilien", 0, emilien.messages));
  transcript.push(...collectMessages("jannik", 0, jannik.messages));
  transcript.push(...collectMessages("djimo", 0, djimo.messages));

  // --- Josiane intègre et place ---
  let josiane = await runJosiane(ctx, request, emilien, jannik, djimo);
  transcript.push(...collectMessages("josiane", 0, josiane.messages));

  // --- Tour 1 : négociation bornée si Josiane a des pushbacks ---
  const pushedTo = new Set(
    (josiane.messages || [])
      .map((m) => (m.to || "").toLowerCase())
      .filter((to): to is AgentName => EMITTER_SET.includes(to as AgentName))
  );
  if (pushedTo.size > 0) {
    const feedbackFor = (name: AgentName) =>
      (josiane.messages || [])
        .filter((m) => (m.to || "").toLowerCase() === name)
        .map((m) => m.text)
        .join("\n");

    const [em2, ja2, dj2] = await Promise.all([
      pushedTo.has("emilien")
        ? runEmilien(ctx, request, feedbackFor("emilien"))
        : Promise.resolve(emilien),
      pushedTo.has("jannik")
        ? runJannik(ctx, request, feedbackFor("jannik"))
        : Promise.resolve(jannik),
      pushedTo.has("djimo")
        ? runDjimo(ctx, request, feedbackFor("djimo"))
        : Promise.resolve(djimo),
    ]);
    if (pushedTo.has("emilien")) transcript.push(...collectMessages("emilien", 1, em2.messages));
    if (pushedTo.has("jannik")) transcript.push(...collectMessages("jannik", 1, ja2.messages));
    if (pushedTo.has("djimo")) transcript.push(...collectMessages("djimo", 1, dj2.messages));

    josiane = await runJosiane(ctx, request, em2, ja2, dj2);
    transcript.push(...collectMessages("josiane", 1, josiane.messages));
    Object.assign(jannik, ja2);
  }

  // --- Matérialisation déterministe du planning ---
  let sessions = dropFixedDuplicates(ctx, materialize(ctx, josiane.sessions || []));
  sessions = enforceOpeningHours(ctx, sessions);
  sessions.sort((a, b) => a.start.localeCompare(b.start));
  enrichTravel(ctx, sessions);
  const workouts = buildWorkouts(sessions, jannik);

  // --- Simone cuisine sur la semaine finale ---
  const simone = await runSimone(ctx, sessions, workouts, request);
  const meals = scrubDisliked(simone.meals || [], ctx.profile.dislikedFoods);

  const warnings = josiane.warnings?.filter(Boolean);
  return {
    weekStart: toLocalIso(ctx.weekStart).slice(0, 10),
    sessions,
    workouts,
    meals,
    groceries: simone.groceries,
    transcript,
    coachNote: jannik.summary,
    warnings: warnings?.length ? warnings : undefined,
  };
}

/* --------- Retouche : opérations minimales sur un plan existant ------ */

async function retouchWeekPlan(
  ctx: PlanContext,
  prev: WeekPlan,
  changeNote: string,
  scopeOpt?: CouncilScope
): Promise<WeekPlan> {
  const scope = {
    jannik: Boolean(scopeOpt?.jannik),
    simone: scopeOpt?.simone !== false,
  };
  const transcript: CouncilMessage[] = [];

  // Si le sport change, Jannik peut rafraîchir exercices/conseils (et parler à Josiane).
  const jannik = scope.jannik ? await runJannik(ctx, changeNote, changeNote) : {};
  transcript.push(...collectMessages("jannik", 0, (jannik as JannikOut).messages));

  // Josiane renvoie des OPÉRATIONS ; on les applique au planning existant.
  const retouch = await runJosianeRetouch(ctx, prev.sessions, changeNote);
  transcript.push(...collectMessages("josiane", 0, retouch.messages));
  const sessions = applyOperations(ctx, prev.sessions, retouch.operations || []);

  // Détails sport : frais si Jannik a tourné, sinon rapprochés depuis le plan précédent.
  const workoutSource: JannikOut = scope.jannik
    ? (jannik as JannikOut)
    : {
        sessions: (prev.workouts || []).map((w) => ({
          activity: w.title,
          intensity: w.intensity,
          exercises: w.exercises,
          tips: w.tips,
        })),
      };
  const workouts = buildWorkouts(sessions, workoutSource);

  // Simone réadapte les repas si demandé.
  let meals = prev.meals;
  let groceries = prev.groceries;
  if (scope.simone) {
    const simone = await runSimone(ctx, sessions, workouts, changeNote);
    meals = scrubDisliked(simone.meals || [], ctx.profile.dislikedFoods);
    groceries = simone.groceries;
  }

  const warnings = retouch.warnings?.filter(Boolean);
  return {
    weekStart: toLocalIso(ctx.weekStart).slice(0, 10),
    sessions,
    workouts: workouts.length ? workouts : prev.workouts,
    meals,
    groceries,
    transcript,
    coachNote: (jannik as JannikOut).summary || prev.coachNote,
    warnings: warnings?.length ? warnings : undefined,
  };
}

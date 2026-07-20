import {
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  listMemory,
  addMemory,
  getWeekPlan,
} from "./store";
import { MODELS, mistralChat, MistralError } from "./mistral";
import { proposeWeekPlan, type CouncilScope } from "./council";
import { commitWeekPlan } from "./commit";
import { buildAgentContext } from "./context";
import type { ChatMode } from "./agents";
import type { AgentName } from "./types";
import {
  JANNIK_CHAT_SYSTEM,
  EMILIEN_CHAT_SYSTEM,
  DJIMO_CHAT_SYSTEM,
  SIMONE_CHAT_SYSTEM,
  JOSIANE_CHAT_SYSTEM,
  COUNCIL_HOST_SYSTEM,
} from "./personas";
import {
  parseFlexibleDate,
  datesForWeekday,
  formatFullDate,
  upcomingDaysPreview,
  toLocalIso,
  startOfWeek,
} from "./dates";
import type { AgentResponse, WeekPlan } from "./types";

/* ----------------------------- Outils ------------------------------ */

const tools = [
  {
    type: "function",
    function: {
      name: "list_events",
      description:
        "Liste tous les événements existants de l'agenda. À appeler avant de planifier pour connaître les créneaux déjà occupés.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "resolve_dates",
      description:
        "Calcule des dates exactes de façon fiable. À utiliser DÈS QUE tu dois connaître une date ou un jour de la semaine (ex: 'les prochains mardis'). Ne calcule JAMAIS les dates toi-même.",
      parameters: {
        type: "object",
        properties: {
          weekday: {
            type: "string",
            description:
              "Jour de la semaine en français (lundi, mardi, …). Optionnel.",
          },
          from: {
            type: "string",
            description:
              "Point de départ : 'today', 'tomorrow', 'next week', ou une date YYYY-MM-DD. Défaut: today.",
          },
          until: {
            type: "string",
            description: "Date de fin incluse (YYYY-MM-DD). Optionnel.",
          },
          count: {
            type: "number",
            description: "Nombre de dates voulues si 'until' absent (défaut 8).",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_event",
      description: "Crée un nouvel événement ponctuel dans l'agenda.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          start: {
            type: "string",
            description: "ISO local sans fuseau, ex: 2026-07-14T09:00:00",
          },
          end: { type: "string", description: "ISO local, ex: 2026-07-14T10:00:00" },
          description: { type: "string" },
          location: { type: "string" },
          category: {
            type: "string",
            description: "travail, sport, perso, santé, famille, loisir…",
          },
          reminderMin: {
            type: "number",
            description:
              "Préavis de rappel en minutes avant le début (ex: 60 = 1h avant, 15 = 15 min avant). Si absent, utilise le défaut global (30 min).",
          },
        },
        required: ["title", "start", "end"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_recurring_event",
      description:
        "Crée un événement récurrent hebdomadaire (ex: un cours tous les mardis). Les dates sont calculées de façon fiable côté serveur — donne juste le jour, les horaires et la période.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          weekday: {
            type: "string",
            description: "Jour en français : lundi, mardi, …",
          },
          startTime: { type: "string", description: "HH:MM, ex: 09:00" },
          endTime: { type: "string", description: "HH:MM, ex: 12:00" },
          from: {
            type: "string",
            description: "Début : 'today' ou YYYY-MM-DD. Défaut: today.",
          },
          until: {
            type: "string",
            description: "Fin incluse : YYYY-MM-DD.",
          },
          location: { type: "string" },
          category: { type: "string" },
        },
        required: ["title", "weekday", "startTime", "endTime", "until"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_event",
      description:
        "Modifie un événement existant. Fournir l'id et uniquement les champs à changer.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          description: { type: "string" },
          location: { type: "string" },
          category: { type: "string" },
          reminderMin: {
            type: "number",
            description:
              "Préavis de rappel en minutes avant le début. Passer 0 pour supprimer un rappel personnalisé et revenir au défaut.",
          },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_reminder",
      description:
        "Définit ou supprime le rappel push d'un événement existant. À utiliser quand l'utilisateur demande d'être notifié X minutes/heures avant un événement précis, ou veut supprimer un rappel.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID de l'événement." },
          reminderMin: {
            type: "number",
            description:
              "Préavis en minutes (ex: 60 = 1h avant, 30 = 30 min avant). Passer 0 pour supprimer le rappel personnalisé et revenir au défaut global.",
          },
        },
        required: ["id", "reminderMin"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_event",
      description: "Supprime un événement de l'agenda via son id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_week_plan",
      description:
        "Réunit LE CONSEIL (Emilien=travail, Jannik=coach sportif, Djimo=loisir, Josiane=agenda, Simone=cuisine) pour proposer un programme de semaine COMPLET : travail (CDD Delos, Monumia, TP), séances de sport avec exercices, moments perso, et repas + liste de courses. À utiliser quand l'utilisateur demande d'organiser/planifier sa semaine. NE crée AUCUN événement : l'utilisateur validera ensuite. Passe la demande brute de l'utilisateur, sans la reformuler.",
      parameters: {
        type: "object",
        properties: {
          request: {
            type: "string",
            description:
              "La demande complète de l'utilisateur, telle quelle (dispos, voiture, heures de travail, TP, souhaits, exceptions…).",
          },
          weekStart: {
            type: "string",
            description:
              "Semaine visée : 'this week'/'cette semaine', 'next week'/'semaine prochaine', ou un lundi YYYY-MM-DD. Défaut: cette semaine.",
          },
        },
        required: ["request"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "replan_week",
      description:
        "RETOUCHE CIBLÉE d'un plan de semaine déjà appliqué : une seule modification ponctuelle, en gardant tout le reste. À utiliser UNIQUEMENT pour un petit changement précis (ex: 'déplace ma séance de mardi à jeudi', 'ajoute un dîner avec Marine vendredi', 'annule la piscine'). NE PAS l'utiliser si l'utilisateur veut REFAIRE / REPLANIFIER toute la semaine ou change plusieurs contraintes à la fois → dans ce cas utilise propose_week_plan. Choisis les agents à réveiller selon la nature du changement.",
      parameters: {
        type: "object",
        properties: {
          changeNote: {
            type: "string",
            description: "La modification demandée, telle quelle.",
          },
          weekStart: {
            type: "string",
            description:
              "Semaine du plan à retoucher : 'cette semaine', 'semaine prochaine', ou un lundi YYYY-MM-DD. Défaut: cette semaine.",
          },
          rerunSport: {
            type: "boolean",
            description:
              "Réveiller Jannik (coach) : true si le changement touche le sport (récup, séance déplacée/ajoutée).",
          },
          rerunWork: {
            type: "boolean",
            description:
              "Réveiller Emilien (travail) : true si le changement touche les heures de travail ou un TP.",
          },
          rerunLeisure: {
            type: "boolean",
            description:
              "Réveiller Djimo (loisir) : true si le changement touche un moment perso (Marine, amis).",
          },
          rerunMeals: {
            type: "boolean",
            description:
              "Réveiller Simone (cuisine) pour réadapter les repas. Défaut: true.",
          },
        },
        required: ["changeNote"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember",
      description:
        "Enregistre une préférence durable de l'utilisateur (ex: 'pas de réunion avant 9h', 'sport le mardi soir'). À utiliser quand il exprime une préférence récurrente.",
      parameters: {
        type: "object",
        properties: { content: { type: "string" } },
        required: ["content"],
      },
    },
  },
];

const CATEGORY_COLORS: Record<string, string> = {
  travail: "#6366f1",
  perso: "#10b981",
  sport: "#f59e0b",
  santé: "#ef4444",
  sante: "#ef4444",
  famille: "#ec4899",
  loisir: "#06b6d4",
};

function colorFor(category?: string): string {
  if (!category) return "#6366f1";
  return CATEGORY_COLORS[category.toLowerCase()] || "#6366f1";
}

/* ------------------------ Exécution d'un outil ---------------------- */

type ToolContext = { actions: string[]; plan?: WeekPlan };

async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<{ result: unknown; changed: boolean }> {
  switch (name) {
    case "list_events": {
      const events = await listEvents();
      return { result: events, changed: false };
    }
    case "resolve_dates": {
      const from = parseFlexibleDate(
        args.from ? String(args.from) : undefined
      );
      const until = args.until ? parseFlexibleDate(String(args.until)) : undefined;
      const count = args.count ? Number(args.count) : 8;
      const weekday = args.weekday ? String(args.weekday) : undefined;
      const dates = weekday
        ? datesForWeekday(weekday, from, until, count)
        : // Sans jour précis : les `count` prochains jours depuis `from`.
          Array.from({ length: until ? 0 : count }, (_, i) => {
            const d = new Date(from);
            d.setDate(d.getDate() + i);
            return d;
          });
      return {
        result: {
          dates: dates.map((d) => ({
            date: toLocalIso(d).slice(0, 10),
            label: formatFullDate(d),
          })),
        },
        changed: false,
      };
    }
    case "create_event": {
      const ev = await createEvent({
        title: String(args.title),
        start: String(args.start),
        end: String(args.end),
        description: args.description ? String(args.description) : undefined,
        location: args.location ? String(args.location) : undefined,
        category: args.category ? String(args.category) : undefined,
        color: colorFor(args.category ? String(args.category) : undefined),
        reminderMin: args.reminderMin != null ? Number(args.reminderMin) : undefined,
      });
      ctx.actions.push(
        `Ajouté : « ${ev.title} »${ev.reminderMin != null ? ` (rappel ${ev.reminderMin} min avant)` : ""}`
      );
      return { result: ev, changed: true };
    }
    case "create_recurring_event": {
      const from = parseFlexibleDate(args.from ? String(args.from) : undefined);
      const until = args.until ? parseFlexibleDate(String(args.until)) : undefined;
      const dates = datesForWeekday(String(args.weekday), from, until);
      const [sh, sm] = String(args.startTime).split(":").map(Number);
      const [eh, em] = String(args.endTime).split(":").map(Number);
      const category = args.category ? String(args.category) : undefined;
      const created: string[] = [];
      for (const d of dates) {
        const start = new Date(d);
        start.setHours(sh || 0, sm || 0, 0, 0);
        const end = new Date(d);
        end.setHours(eh || 0, em || 0, 0, 0);
        const ev = await createEvent({
          title: String(args.title),
          start: toLocalIso(start),
          end: toLocalIso(end),
          location: args.location ? String(args.location) : undefined,
          category,
          color: colorFor(category),
        });
        created.push(ev.start);
      }
      ctx.actions.push(
        `Ajouté « ${String(args.title)} » sur ${created.length} ${String(
          args.weekday
        )}s`
      );
      return {
        result: { count: created.length, dates: created },
        changed: created.length > 0,
      };
    }
    case "update_event": {
      const { id, ...rest } = args as { id: string } & Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined && v !== null && v !== "") patch[k] = v;
      }
      if (patch.category) patch.color = colorFor(String(patch.category));
      // reminderMin peut être 0 (suppression du rappel perso) — on le passe explicitement.
      if (args.reminderMin != null) patch.reminderMin = Number(args.reminderMin) || undefined;
      const ev = await updateEvent(String(id), patch);
      if (!ev) return { result: { error: "événement introuvable" }, changed: false };
      ctx.actions.push(`Modifié : « ${ev.title} »`);
      return { result: ev, changed: true };
    }
    case "set_reminder": {
      const evId = String(args.id);
      const minutes = Number(args.reminderMin);
      // 0 = supprimer le rappel personnalisé (retour au défaut global).
      const patch = { reminderMin: minutes > 0 ? minutes : undefined };
      const ev = await updateEvent(evId, patch);
      if (!ev) return { result: { error: "événement introuvable" }, changed: false };
      const msg =
        minutes > 0
          ? `Rappel de ${minutes} min défini pour « ${ev.title} »`
          : `Rappel personnalisé supprimé pour « ${ev.title} » (retour au défaut)`;
      ctx.actions.push(msg);
      return { result: { id: ev.id, title: ev.title, reminderMin: ev.reminderMin }, changed: true };
    }
    case "delete_event": {
      const ok = await deleteEvent(String(args.id));
      if (ok) ctx.actions.push("Supprimé un événement");
      return { result: { deleted: ok }, changed: ok };
    }
    case "propose_week_plan": {
      const plan = await proposeWeekPlan(
        String(args.request || ""),
        args.weekStart ? String(args.weekStart) : undefined
      );
      // Auto-acceptation : le Conseil applique directement son plan.
      await commitWeekPlan(plan);
      plan.committed = true;
      ctx.plan = plan;
      return {
        result: {
          weekStart: plan.weekStart,
          sessionsCount: plan.sessions.length,
          mealsCount: plan.meals?.length || 0,
          coachNote: plan.coachNote,
          warnings: plan.warnings,
          note: "Le Conseil a délibéré et APPLIQUÉ directement le plan (travail, sport, loisir, repas). Il est déjà dans l'agenda et affiché à l'utilisateur. Invite-le seulement à demander un ajustement s'il le souhaite.",
        },
        changed: true,
      };
    }
    case "replan_week": {
      const weekStart = toLocalIso(
        startOfWeek(parseFlexibleDate(args.weekStart ? String(args.weekStart) : undefined))
      ).slice(0, 10);
      const previous = await getWeekPlan(weekStart);
      if (!previous) {
        return {
          result: {
            error:
              "Aucun plan validé trouvé pour cette semaine. Propose d'abord un plan avec propose_week_plan.",
          },
          changed: false,
        };
      }
      const scope: CouncilScope = {
        josiane: true,
        jannik: Boolean(args.rerunSport),
        emilien: Boolean(args.rerunWork),
        djimo: Boolean(args.rerunLeisure),
        simone: args.rerunMeals === false ? false : true,
      };
      const plan = await proposeWeekPlan("", weekStart, {
        scope,
        previous,
        changeNote: String(args.changeNote || ""),
      });
      // Auto-acceptation : la retouche est appliquée directement (idempotent).
      await commitWeekPlan(plan);
      plan.committed = true;
      ctx.plan = plan;
      return {
        result: {
          weekStart: plan.weekStart,
          sessionsCount: plan.sessions.length,
          note: "Plan retouché par les agents concernés et APPLIQUÉ directement dans l'agenda. Invite l'utilisateur à demander un autre ajustement si besoin.",
        },
        changed: true,
      };
    }
    case "remember": {
      const item = await addMemory(String(args.content));
      ctx.actions.push(`Mémorisé : « ${item.content} »`);
      return { result: item, changed: false };
    }
    default:
      return { result: { error: `outil inconnu: ${name}` }, changed: false };
  }
}

/* --------------------------- Boucle agent --------------------------- */

type IncomingMessage = { role: "user" | "assistant"; content: string };

/** Noms d'outils autorisés par mode de conversation. */
const TOOLS_BY_MODE: Record<ChatMode, string[]> = {
  agenda: [
    "list_events",
    "resolve_dates",
    "create_event",
    "create_recurring_event",
    "update_event",
    "delete_event",
    "remember",
  ],
  council: ["propose_week_plan", "replan_week", "list_events", "resolve_dates"],
  josiane: [
    "list_events",
    "resolve_dates",
    "update_event",
    "create_event",
    "delete_event",
    "replan_week",
    "remember",
  ],
  emilien: ["list_events", "resolve_dates", "update_event", "create_event", "delete_event", "remember"],
  jannik: ["list_events", "resolve_dates", "update_event", "create_event", "delete_event", "remember"],
  djimo: ["list_events", "resolve_dates", "update_event", "create_event", "delete_event", "remember"],
  simone: ["list_events", "resolve_dates", "update_event", "create_event", "delete_event", "remember"],
};

const CHAT_SYSTEMS: Record<AgentName, string> = {
  jannik: JANNIK_CHAT_SYSTEM,
  emilien: EMILIEN_CHAT_SYSTEM,
  djimo: DJIMO_CHAT_SYSTEM,
  simone: SIMONE_CHAT_SYSTEM,
  josiane: JOSIANE_CHAT_SYSTEM,
};

function toolsForMode(mode: ChatMode) {
  const allowed = TOOLS_BY_MODE[mode] || TOOLS_BY_MODE.agenda;
  return tools.filter((t) => allowed.includes(t.function.name));
}

const AGENDA_SYSTEM = (today: Date, memoryBlock: string) =>
  `Tu es l'assistant de l'agenda personnel de l'utilisateur. Sur cet écran, tu t'occupes UNIQUEMENT de gérer des éléments de l'agenda : créer, déplacer, modifier ou supprimer des événements ponctuels ou récurrents.

Aujourd'hui : ${formatFullDate(today)}.

Prochains jours (pour te repérer — NE calcule jamais de dates toi-même) :
${upcomingDaysPreview(today, 14)}

Règles :
- Pour TOUTE date ou jour de semaine, appelle resolve_dates. Ne devine jamais une date.
- Pour un événement qui se répète (ex: "tous les mardis"), utilise create_recurring_event.
- Utilise list_events avant de modifier pour éviter les chevauchements.
- Les dates que tu produis sont au format ISO local sans fuseau (ex: 2026-07-14T09:00:00).
- Quand l'utilisateur exprime une préférence récurrente, appelle remember.
- Tu ne planifies PAS la semaine entière ici : si l'utilisateur veut organiser toute sa semaine (travail + sport + loisir + repas), invite-le à ouvrir une « Nouvelle séance du Conseil » via le bouton dédié.
- Réponds en français, de façon concise et chaleureuse.

Préférences enregistrées de l'utilisateur :
${memoryBlock}`;

/** Construit le message système selon le mode de conversation. */
async function buildSystemContent(
  mode: ChatMode,
  today: Date,
  memoryBlock: string,
  now?: string,
  conversationContext?: string
): Promise<string> {
  if (mode === "agenda") {
    const base = AGENDA_SYSTEM(today, memoryBlock);
    return conversationContext ? base + conversationContext : base;
  }

  const dateBlock = `Aujourd'hui : ${formatFullDate(
    today
  )}.\n\nProchains jours (NE calcule jamais de dates toi-même) :\n${upcomingDaysPreview(
    today,
    14
  )}`;

  if (mode === "council") {
    const base = `${COUNCIL_HOST_SYSTEM(dateBlock)}\n\nPréférences enregistrées de l'utilisateur :\n${memoryBlock}`;
    return conversationContext ? base + conversationContext : base;
  }

  // Mode agent : persona conversationnel + contexte déterministe.
  const context = await buildAgentContext(mode, now);
  const base = `${CHAT_SYSTEMS[mode]}\n\n${dateBlock}\n\n${context}\n\nPréférences enregistrées de l'utilisateur :\n${memoryBlock}`;
  return conversationContext ? base + conversationContext : base;
}

export async function runAgent(
  history: IncomingMessage[],
  opts?: { mode?: ChatMode; now?: string; conversationContext?: string }
): Promise<AgentResponse> {
  const mode: ChatMode = opts?.mode || "agenda";
  const memory = await listMemory();
  const memoryBlock =
    memory.length > 0
      ? memory.map((m) => `- ${m.content}`).join("\n")
      : "(aucune préférence enregistrée pour l'instant)";

  const today = opts?.now && !Number.isNaN(Date.parse(opts.now))
    ? new Date(opts.now)
    : new Date();

  const system = {
    role: "system",
    content: await buildSystemContent(mode, today, memoryBlock, opts?.now, opts?.conversationContext),
  };
  const modeTools = toolsForMode(mode);

  const messages: Record<string, unknown>[] = [
    system,
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const ctx: ToolContext = { actions: [] };
  let changed = false;
  const MAX_TURNS = 6;

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const message = await mistralChat({
        model: MODELS.small,
        messages,
        tools: modeTools,
        toolChoice: "auto",
        temperature: 0.3,
      });

      messages.push(message);

      const toolCalls = message.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        return {
          reply: message.content || "C'est fait !",
          actions: ctx.actions,
          changed,
          plan: ctx.plan,
        };
      }

      for (const call of toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          args = {};
        }
        const { result, changed: c } = await runTool(
          call.function.name,
          args,
          ctx
        );
        if (c) changed = true;
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify(result),
        });
      }
    }
  } catch (err) {
    if (err instanceof MistralError && err.kind === "no-key") {
      return {
        reply:
          "⚠️ La clé API Mistral n'est pas configurée. Ajoute MISTRAL_API_KEY dans ton fichier .env.local puis relance le serveur.",
        actions: ctx.actions,
        changed,
      };
    }
    const detail =
      err instanceof MistralError ? ` (${err.status}) ${err.message}` : "";
    return {
      reply: `❌ Erreur de l'API Mistral${detail}`,
      actions: ctx.actions,
      changed,
      plan: ctx.plan,
    };
  }

  return {
    reply:
      "J'ai atteint la limite d'étapes. Voici ce que j'ai pu faire — reformule si besoin.",
    actions: ctx.actions,
    changed,
    plan: ctx.plan,
  };
}

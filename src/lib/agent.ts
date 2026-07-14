import {
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  listMemory,
  addMemory,
} from "./store";
import type { AgentResponse } from "./types";

const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";
const MODEL = process.env.MISTRAL_MODEL || "mistral-small-latest";

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
      name: "create_event",
      description: "Crée un nouvel événement dans l'agenda.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Titre de l'événement" },
          start: {
            type: "string",
            description: "Date/heure de début au format ISO local, ex: 2026-07-14T09:00:00",
          },
          end: {
            type: "string",
            description: "Date/heure de fin au format ISO local, ex: 2026-07-14T10:00:00",
          },
          description: { type: "string" },
          location: { type: "string" },
          category: {
            type: "string",
            description: "Catégorie libre : travail, sport, perso, santé, etc.",
          },
        },
        required: ["title", "start", "end"],
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
        },
        required: ["id"],
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
      name: "remember",
      description:
        "Enregistre une préférence durable de l'utilisateur en mémoire (ex: 'ne pas mettre de réunion avant 9h', 'sport le mardi soir'). À utiliser quand l'utilisateur exprime une préférence récurrente.",
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

async function runTool(
  name: string,
  args: Record<string, unknown>,
  actions: string[]
): Promise<{ result: unknown; changed: boolean }> {
  switch (name) {
    case "list_events": {
      const events = await listEvents();
      return { result: events, changed: false };
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
      });
      actions.push(`Ajouté : « ${ev.title} »`);
      return { result: ev, changed: true };
    }
    case "update_event": {
      const { id, ...rest } = args as { id: string } & Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined && v !== null && v !== "") patch[k] = v;
      }
      if (patch.category) patch.color = colorFor(String(patch.category));
      const ev = await updateEvent(String(id), patch);
      if (!ev) return { result: { error: "événement introuvable" }, changed: false };
      actions.push(`Modifié : « ${ev.title} »`);
      return { result: ev, changed: true };
    }
    case "delete_event": {
      const ok = await deleteEvent(String(args.id));
      if (ok) actions.push("Supprimé un événement");
      return { result: { deleted: ok }, changed: ok };
    }
    case "remember": {
      const item = await addMemory(String(args.content));
      actions.push(`Mémorisé : « ${item.content} »`);
      return { result: item, changed: false };
    }
    default:
      return { result: { error: `outil inconnu: ${name}` }, changed: false };
  }
}

/* --------------------------- Boucle agent --------------------------- */

type IncomingMessage = { role: "user" | "assistant"; content: string };

export async function runAgent(
  history: IncomingMessage[]
): Promise<AgentResponse> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    return {
      reply:
        "⚠️ La clé API Mistral n'est pas configurée. Ajoute MISTRAL_API_KEY dans ton fichier .env.local puis relance le serveur.",
      actions: [],
      changed: false,
    };
  }

  const memory = await listMemory();
  const memoryBlock =
    memory.length > 0
      ? memory.map((m) => `- ${m.content}`).join("\n")
      : "(aucune préférence enregistrée pour l'instant)";

  const nowIso = new Date().toISOString();
  const weekday = new Date().toLocaleDateString("fr-FR", { weekday: "long" });

  const system = {
    role: "system",
    content: `Tu es l'assistant d'un agenda personnel. Tu aides l'utilisateur à organiser son emploi du temps de façon intelligente.

Date/heure actuelle : ${nowIso} (${weekday}).

Règles :
- Utilise TOUJOURS list_events avant de planifier, pour éviter les chevauchements.
- Propose des créneaux cohérents : évite les conflits, regroupe les tâches similaires, garde des pauses réalistes.
- Respecte scrupuleusement les préférences enregistrées ci-dessous.
- Les dates que tu produis doivent être au format ISO local sans fuseau (ex: 2026-07-14T09:00:00).
- Quand l'utilisateur exprime une préférence récurrente ("je préfère…", "toujours…", "jamais…"), appelle remember.
- Après tes actions, réponds en français, de façon concise et chaleureuse, en résumant ce que tu as fait.

Préférences enregistrées de l'utilisateur :
${memoryBlock}`,
  };

  const messages: Record<string, unknown>[] = [
    system,
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const actions: string[] = [];
  let changed = false;
  const MAX_TURNS = 6;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await fetch(MISTRAL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        reply: `❌ Erreur de l'API Mistral (${res.status}) : ${text.slice(0, 300)}`,
        actions,
        changed,
      };
    }

    const data = await res.json();
    const message = data.choices?.[0]?.message;
    if (!message) {
      return { reply: "Réponse vide du modèle.", actions, changed };
    }

    messages.push(message);

    const toolCalls = message.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      return {
        reply: message.content || "C'est fait !",
        actions,
        changed,
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
        actions
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

  return {
    reply:
      "J'ai atteint la limite d'étapes. Voici ce que j'ai pu faire — reformule si besoin.",
    actions,
    changed,
  };
}

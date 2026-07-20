/** Client minimal pour l'API chat de Mistral, partagé par l'agent et le planner. */

const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";

/**
 * Modèles par rôle. Petit modèle par défaut ; gros modèle réservé au
 * raisonnement spatio-temporel du planificateur.
 */
const SMALL =
  process.env.MISTRAL_MODEL_SMALL ||
  process.env.MISTRAL_MODEL ||
  "mistral-small-latest";

export const MODELS = {
  small: SMALL,
  /** Josiane (agenda) : raisonnement spatio-temporel & arbitrage → gros modèle. */
  planner: process.env.MISTRAL_MODEL_PLANNER || "mistral-medium-latest",
  /** Jannik (coach sportif). */
  coach: process.env.MISTRAL_MODEL_COACH || SMALL,
  /** Emilien (travail). */
  work: process.env.MISTRAL_MODEL_WORK || SMALL,
  /** Djimo (loisir). */
  leisure: process.env.MISTRAL_MODEL_LEISURE || SMALL,
  /** Simone (cheffe cuisinière). */
  chef: process.env.MISTRAL_MODEL_CHEF || SMALL,
};

export class MistralError extends Error {
  constructor(
    message: string,
    public kind: "no-key" | "api" = "api",
    public status?: number
  ) {
    super(message);
  }
}

type Msg = Record<string, unknown>;

type ChatOptions = {
  model: string;
  messages: Msg[];
  tools?: unknown[];
  toolChoice?: "auto" | "none" | "any";
  temperature?: number;
  /** Force une réponse JSON (response_format json_object). */
  json?: boolean;
};

/** Appelle l'API et renvoie le `message` brut du premier choix. */
export async function mistralChat(opts: ChatOptions): Promise<Record<string, any>> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new MistralError("Clé API Mistral manquante", "no-key");

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.3,
  };
  if (opts.tools) {
    body.tools = opts.tools;
    body.tool_choice = opts.toolChoice ?? "auto";
  }
  if (opts.json) body.response_format = { type: "json_object" };

  const res = await fetch(MISTRAL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new MistralError(text.slice(0, 300), "api", res.status);
  }

  const data = await res.json();
  const message = data.choices?.[0]?.message;
  if (!message) throw new MistralError("Réponse vide du modèle", "api");
  return message;
}

/** Extrait et parse le premier objet JSON d'un texte de modèle. */
export function parseJsonLoose<T>(text: string): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

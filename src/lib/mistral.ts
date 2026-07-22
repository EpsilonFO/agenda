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

/** Timeout d'UN appel API (le pipeline du Conseil en enchaîne plusieurs). */
const CALL_TIMEOUT_MS = 120_000;
/** Statuts transitoires : on retente avec backoff (rate-limit, indispo). */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_TRANSIENT_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Appelle l'API et renvoie le `message` brut du premier choix.
 * Timeout par appel + retries automatiques sur erreurs transitoires (429/5xx).
 */
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

  let lastErr: MistralError | null = null;
  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = 2000 * attempt;
      console.warn(
        `[mistral] ${lastErr?.status ?? "réseau"} — retry ${attempt}/${MAX_TRANSIENT_RETRIES} dans ${backoff}ms (${opts.model})`
      );
      await sleep(backoff);
    }

    let res: Response;
    try {
      res = await fetch(MISTRAL_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (err) {
      // Timeout ou erreur réseau : transitoire, on retente.
      const isTimeout = err instanceof Error && err.name === "TimeoutError";
      lastErr = new MistralError(
        isTimeout
          ? `Timeout après ${CALL_TIMEOUT_MS / 1000}s (${opts.model})`
          : `Erreur réseau : ${err instanceof Error ? err.message : String(err)}`,
        "api"
      );
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      lastErr = new MistralError(text.slice(0, 300), "api", res.status);
      if (RETRYABLE_STATUS.has(res.status)) continue;
      throw lastErr;
    }

    const data = await res.json();
    const message = data.choices?.[0]?.message;
    if (!message) throw new MistralError("Réponse vide du modèle", "api");
    return message;
  }

  throw lastErr || new MistralError("Échec après retries", "api");
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

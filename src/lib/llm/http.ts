/**
 * Plomberie HTTP commune à tous les providers : timeout, retries sur erreurs
 * transitoires, lecture de flux SSE. Écrite une fois, valable partout — c'est
 * la partie qu'on ne veut surtout pas voir dupliquée par provider.
 */

import { LlmError } from "./types";

/**
 * Timeout d'UN appel API. Large : en effort élevé, un modèle de raisonnement
 * peut réfléchir plusieurs minutes, et un timeout trop court jette tout ce
 * raisonnement pour recommencer de zéro au retry.
 */
export const CALL_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 600_000;

/** Statuts transitoires : on retente avec backoff (rate-limit, indispo). */
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);
const MAX_TRANSIENT_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Exécute `attempt` en le retentant sur erreur transitoire (backoff linéaire).
 * L'état conservé entre deux essais vit dans la closure de l'appelant — c'est
 * ce qui permet à OpenAI de désactiver les résumés de raisonnement et de
 * retenter sans eux.
 */
export async function withRetries<T>(
  label: string,
  attempt: (attemptNo: number) => Promise<T>
): Promise<T> {
  let lastErr: LlmError | null = null;
  for (let i = 0; i <= MAX_TRANSIENT_RETRIES; i++) {
    if (i > 0) {
      const backoff = 2000 * i;
      console.warn(
        `[llm:${label}] ${lastErr?.status ?? lastErr?.message ?? "erreur inconnue"} — retry ${i}/${MAX_TRANSIENT_RETRIES} dans ${backoff}ms`
      );
      await sleep(backoff);
    }
    try {
      return await attempt(i);
    } catch (err) {
      const e = asLlmError(err);
      if (!e.retryable) throw e;
      lastErr = e;
    }
  }
  throw lastErr || new LlmError("Échec après retries", "api");
}

function asLlmError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  const isAbort =
    err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
  if (isAbort) {
    return new LlmError(
      `Timeout après ${CALL_TIMEOUT_MS / 1000}s`,
      "timeout",
      undefined,
      undefined,
      true
    );
  }
  const msg = err instanceof Error ? err.message : String(err);
  // Erreur réseau (DNS, socket, TLS) : transitoire par nature.
  return new LlmError(`Erreur réseau : ${msg}`, "api", undefined, undefined, true);
}

/**
 * POST JSON avec timeout. Les erreurs réseau/timeout remontent en LlmError
 * retryable ; une réponse non-2xx remonte en LlmError avec le corps tronqué,
 * retryable seulement si le statut l'est.
 */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  provider: string
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (err) {
    const e = asLlmError(err);
    e.provider = provider;
    throw e;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new LlmError(
      extractApiMessage(text) || `HTTP ${res.status}`,
      "api",
      res.status,
      provider,
      RETRYABLE_STATUS.has(res.status)
    );
  }
  return res;
}

/**
 * Extrait le message utile d'un corps d'erreur. Les quatre APIs enveloppent
 * différemment (`error.message`, `message`, `detail`) — on tente, sinon on
 * renvoie le brut tronqué.
 */
function extractApiMessage(text: string): string {
  if (!text) return "";
  try {
    const j = JSON.parse(text) as Record<string, any>;
    const msg = j?.error?.message ?? j?.message ?? j?.detail ?? j?.error;
    if (typeof msg === "string" && msg) return msg.slice(0, 300);
  } catch {
    // pas du JSON : on garde le texte brut
  }
  return text.slice(0, 300);
}

/**
 * Lit un flux SSE et appelle onEvent pour chaque événement JSON.
 * Le AbortSignal du fetch couvre aussi la lecture du flux.
 */
export async function readSse(
  res: Response,
  onEvent: (evt: Record<string, any>) => void,
  provider: string
): Promise<void> {
  if (!res.body) {
    throw new LlmError("Réponse sans corps de flux", "api", undefined, provider, true);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const dataLine = chunk.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        const payload = dataLine.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          onEvent(JSON.parse(payload));
        } catch {
          // fragment non-JSON : ignoré
        }
      }
    }
  } catch (err) {
    // Une LlmError levée par onEvent (erreur applicative dans le flux) passe.
    if (err instanceof LlmError) throw err;
    const e = asLlmError(err);
    e.provider = provider;
    e.message = `Flux interrompu : ${e.message}`;
    throw e;
  }
}

/** Concatène base + chemin sans doubler ni perdre le slash. */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/**
 * Client minimal pour l'API Responses d'OpenAI, partagé par l'agent et le planner.
 *
 * On utilise /v1/responses (et pas /v1/chat/completions) : sur la famille
 * GPT-5.6, les function tools combinés au raisonnement ne sont supportés que
 * sur cette API. L'interface exposée reste au format chat-completions
 * (messages + tool_calls) : la traduction se fait ici, aux deux frontières.
 */

const OPENAI_URL = "https://api.openai.com/v1/responses";

/**
 * Modèle unique : GPT-5.6 Terra (le tier intermédiaire de la famille GPT-5.6).
 * Chaque rôle reste surchargeable individuellement via env si besoin.
 */
const TERRA = process.env.OPENAI_MODEL || "gpt-5.6-terra";

export const MODELS = {
  small: TERRA,
  /** Josiane (agenda) : raisonnement spatio-temporel & arbitrage. */
  planner: process.env.OPENAI_MODEL_PLANNER || TERRA,
  /** Jannik (coach sportif). */
  coach: process.env.OPENAI_MODEL_COACH || TERRA,
  /** Emilien (travail). */
  work: process.env.OPENAI_MODEL_WORK || TERRA,
  /** Djimo (loisir). */
  leisure: process.env.OPENAI_MODEL_LEISURE || TERRA,
  /** Simone (cheffe cuisinière). */
  chef: process.env.OPENAI_MODEL_CHEF || TERRA,
};

/**
 * Effort de raisonnement appliqué à tous les appels.
 * Niveaux de la famille 5.6 : none|low|medium|high|xhigh|max — mais tous les
 * tiers n'acceptent pas "max" (Luna le refuse) ; xhigh est le défaut sûr.
 */
const REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || "xhigh";

export class OpenAIError extends Error {
  constructor(
    message: string,
    public kind: "no-key" | "api" = "api",
    public status?: number
  ) {
    super(message);
  }
}

type Msg = Record<string, any>;

type ChatOptions = {
  model: string;
  messages: Msg[];
  tools?: unknown[];
  toolChoice?: "auto" | "none" | "required";
  /** Force une réponse JSON (text.format json_object). */
  json?: boolean;
  /** Étiquette pour les logs (nom de l'agent) — défaut : le modèle. */
  label?: string;
};

/**
 * Timeout d'UN appel API. Large : en effort xhigh/max, Terra peut raisonner
 * plusieurs minutes, et un timeout trop court rejette tout ce raisonnement
 * pour recommencer de zéro au retry.
 */
const CALL_TIMEOUT_MS = 600_000;
/** Statuts transitoires : on retente avec backoff (rate-limit, indispo). */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_TRANSIENT_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * messages (format chat-completions) → items d'input de l'API Responses.
 *
 * - Un message assistant produit par openaiChat porte `_items` : on rejoue ces
 *   items bruts tels quels (reasoning + function_call + message) — l'API exige
 *   qu'un function_call soit accompagné de son item de raisonnement.
 * - Un message role:"tool" devient un function_call_output.
 * - Le reste (system/user/assistant texte) passe tel quel.
 */
function toInputItems(messages: Msg[]): unknown[] {
  const items: unknown[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      items.push({
        type: "function_call_output",
        call_id: m.tool_call_id,
        output: String(m.content ?? ""),
      });
    } else if (m.role === "assistant" && Array.isArray(m._items)) {
      items.push(...m._items);
    } else {
      items.push({ role: m.role, content: String(m.content ?? "") });
    }
  }
  return items;
}

/** Outil format chat-completions ({type,function:{…}}) → format Responses (aplati). */
function toResponsesTool(t: unknown): unknown {
  const tool = t as Msg;
  if (tool?.type === "function" && tool.function) {
    return {
      type: "function",
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    };
  }
  return t;
}

/**
 * Lit un flux SSE et appelle onEvent pour chaque événement JSON.
 * Le AbortSignal du fetch couvre aussi la lecture du flux.
 */
async function readSse(res: Response, onEvent: (evt: Msg) => void): Promise<void> {
  if (!res.body) throw new OpenAIError("Réponse sans corps de flux", "api");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
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
}

/**
 * Appelle l'API en streaming et renvoie un message au format chat-completions :
 * { role:"assistant", content, tool_calls?, _items }. `_items` porte les items
 * bruts de la réponse, à rejouer si le message est renvoyé dans l'historique.
 *
 * Le streaming sert à l'observabilité : les résumés de raisonnement du modèle
 * (l'API n'expose jamais la chaîne de pensée brute) sont imprimés au fil de
 * l'eau dans la console serveur, puis la durée et les tokens de raisonnement.
 *
 * Timeout par appel + retries automatiques sur erreurs transitoires (429/5xx).
 * Pas de paramètre temperature : les modèles de raisonnement GPT-5.x
 * n'acceptent que la valeur par défaut.
 */
export async function openaiChat(opts: ChatOptions): Promise<Record<string, any>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new OpenAIError("Clé API OpenAI manquante", "no-key");

  const label = opts.label || opts.model;
  // Les résumés de raisonnement ne sont pas dispo sur toutes les orgs/modèles :
  // en cas de 400 les mentionnant, on les coupe et on retente sans.
  let withSummary = true;

  let lastErr: OpenAIError | null = null;
  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = 2000 * attempt;
      console.warn(
        `[openai:${label}] ${lastErr?.status ?? lastErr?.message ?? "erreur inconnue"} — retry ${attempt}/${MAX_TRANSIENT_RETRIES} dans ${backoff}ms`
      );
      await sleep(backoff);
    }

    const body: Record<string, unknown> = {
      model: opts.model,
      input: toInputItems(opts.messages),
      reasoning: withSummary
        ? { effort: REASONING_EFFORT, summary: "auto" }
        : { effort: REASONING_EFFORT },
      stream: true,
    };
    if (opts.tools) {
      body.tools = opts.tools.map(toResponsesTool);
      body.tool_choice = opts.toolChoice ?? "auto";
    }
    if (opts.json) body.text = { format: { type: "json_object" } };

    const t0 = Date.now();
    console.log(`[openai:${label}] appel ${opts.model} (effort ${REASONING_EFFORT})…`);

    let res: Response;
    try {
      res = await fetch(OPENAI_URL, {
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
      lastErr = new OpenAIError(
        isTimeout
          ? `Timeout après ${CALL_TIMEOUT_MS / 1000}s (${opts.model})`
          : `Erreur réseau : ${err instanceof Error ? err.message : String(err)}`,
        "api"
      );
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 400 && withSummary && /summary/i.test(text)) {
        console.warn(`[openai:${label}] résumés de raisonnement indisponibles — désactivés`);
        withSummary = false;
        lastErr = new OpenAIError(text.slice(0, 300), "api", res.status);
        continue;
      }
      lastErr = new OpenAIError(text.slice(0, 300), "api", res.status);
      if (RETRYABLE_STATUS.has(res.status)) continue;
      throw lastErr;
    }

    // Lecture du flux : résumés de raisonnement imprimés, réponse finale collectée.
    let final: Msg | null = null;
    try {
      await readSse(res, (evt) => {
        const type = String(evt.type || "");
        if (type === "response.reasoning_summary_part.done") {
          const text = evt.part?.text;
          if (text) console.log(`[openai:${label}] 💭 ${String(text).replace(/\n+/g, " ")}`);
        } else if (
          type === "response.completed" ||
          type === "response.incomplete" ||
          type === "response.failed"
        ) {
          final = evt.response ?? null;
        } else if (type === "error") {
          throw new OpenAIError(String(evt.message || "Erreur de flux").slice(0, 300), "api");
        }
      });
    } catch (err) {
      if (err instanceof OpenAIError) throw err;
      const isTimeout =
        err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      lastErr = new OpenAIError(
        isTimeout
          ? `Timeout après ${CALL_TIMEOUT_MS / 1000}s en cours de flux (${opts.model})`
          : `Flux interrompu : ${err instanceof Error ? err.message : String(err)}`,
        "api"
      );
      continue;
    }

    // TS ne voit pas l'assignation faite dans la closure de readSse.
    const finalResp = final as Msg | null;
    if (!finalResp) {
      lastErr = new OpenAIError("Flux terminé sans réponse complète", "api");
      continue;
    }
    if (finalResp.status === "failed" || finalResp.error) {
      throw new OpenAIError(
        String(finalResp.error?.message || "Échec de la réponse").slice(0, 300),
        "api"
      );
    }
    if (finalResp.status === "incomplete") {
      console.warn(
        `[openai:${label}] réponse incomplète (${finalResp.incomplete_details?.reason || "raison inconnue"})`
      );
    }

    const output: Msg[] = Array.isArray(finalResp.output) ? finalResp.output : [];
    if (output.length === 0) throw new OpenAIError("Réponse vide du modèle", "api");

    const secs = Math.round((Date.now() - t0) / 1000);
    const reasoningTokens = finalResp.usage?.output_tokens_details?.reasoning_tokens;
    const outputTokens = finalResp.usage?.output_tokens;
    console.log(
      `[openai:${label}] réponse en ${secs}s` +
        (reasoningTokens != null
          ? ` — ${reasoningTokens} tokens de raisonnement / ${outputTokens} tokens de sortie`
          : "")
    );

    const content = output
      .filter((i) => i.type === "message")
      .flatMap((i) => (Array.isArray(i.content) ? i.content : []))
      .filter((c: Msg) => c.type === "output_text")
      .map((c: Msg) => c.text)
      .join("");

    const toolCalls = output
      .filter((i) => i.type === "function_call")
      .map((i) => ({
        id: i.call_id,
        function: { name: i.name, arguments: i.arguments },
      }));

    return {
      role: "assistant",
      content,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      _items: output,
    };
  }

  throw lastErr || new OpenAIError("Échec après retries", "api");
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

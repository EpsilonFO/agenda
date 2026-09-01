/**
 * Provider générique « OpenAI-compatible » : POST /chat/completions.
 *
 * Sert Mistral, DeepSeek, et tout endpoint qui parle ce dialecte (Ollama,
 * Groq, OpenRouter, vLLM, LM Studio…) via LLM_BASE_URL. Comme c'est le format
 * pivot de l'application, la traduction se réduit ici à du nettoyage.
 */

import { LlmError } from "../types";
import type { LlmMessage, LlmToolCall, ResolvedRequest } from "../types";
import { joinUrl, postJson } from "../http";

/** Retire les champs internes et normalise ce que l'API n'accepte pas. */
function toNativeMessages(messages: LlmMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      return {
        role: "tool",
        tool_call_id: m.tool_call_id,
        name: m.name,
        content: String(m.content ?? ""),
      };
    }
    if (m.role === "assistant") {
      const out: Record<string, unknown> = {
        role: "assistant",
        // Un assistant qui n'appelle que des outils a un content vide, pas null :
        // Mistral rejette null.
        content: typeof m.content === "string" ? m.content : "",
      };
      if (m.tool_calls?.length) {
        out.tool_calls = m.tool_calls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.function.name, arguments: c.function.arguments || "{}" },
        }));
      }
      return out;
    }
    return { role: m.role, content: String(m.content ?? "") };
  });
}

/**
 * Le mode JSON de plusieurs implémentations (DeepSeek en tête) exige que le
 * mot « json » figure dans le prompt, sinon l'API refuse ou boucle à vide.
 * On l'ajoute discrètement si l'appelant ne l'a pas déjà écrit.
 */
function ensureJsonHint(messages: Record<string, unknown>[]): Record<string, unknown>[] {
  const mentionsJson = messages.some((m) => /json/i.test(String(m.content ?? "")));
  if (mentionsJson) return messages;
  const idx = messages.findIndex((m) => m.role === "system");
  const hint = " Réponds uniquement avec un objet JSON valide.";
  if (idx >= 0) {
    const copy = [...messages];
    copy[idx] = { ...copy[idx], content: `${String(copy[idx].content ?? "")}${hint}` };
    return copy;
  }
  return [{ role: "system", content: hint.trim() }, ...messages];
}

function parseToolCalls(raw: unknown): LlmToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c: any) => c?.function?.name)
    .map((c: any, i: number) => ({
      // Certains serveurs compatibles omettent l'id : on en fabrique un stable,
      // sinon le message tool de réponse ne peut pas être rattaché.
      id: String(c.id || `call_${i}`),
      function: {
        name: String(c.function.name),
        arguments:
          typeof c.function.arguments === "string"
            ? c.function.arguments
            : JSON.stringify(c.function.arguments ?? {}),
      },
    }));
}

export async function chatCompletions(req: ResolvedRequest): Promise<LlmMessage> {
  const { provider } = req;
  let messages = toNativeMessages(req.messages);
  if (req.json) messages = ensureJsonHint(messages);

  const body: Record<string, unknown> = { model: req.model, messages, stream: false };

  if (req.tools?.length && provider.capabilities.tools) {
    // Format pivot == format natif : rien à traduire.
    body.tools = req.tools;
    body.tool_choice = req.toolChoice ?? "auto";
  }
  if (req.json && provider.capabilities.jsonMode) {
    body.response_format = { type: "json_object" };
  }
  if (req.maxTokens) body.max_tokens = req.maxTokens;

  const t0 = Date.now();
  console.log(`[llm:${req.label}] ${provider.label} · ${req.model}…`);

  const res = await postJson(
    joinUrl(req.baseUrl, "/chat/completions"),
    // Serveur local sans authentification : pas d'en-tête plutôt qu'un
    // « Bearer » vide, que certains serveurs stricts rejettent.
    req.apiKey ? { Authorization: `Bearer ${req.apiKey}` } : {},
    body,
    provider.label
  );
  const json = (await res.json()) as Record<string, any>;

  const choice = json.choices?.[0];
  if (!choice) {
    throw new LlmError("Réponse vide du modèle", "api", undefined, provider.label, true);
  }
  const msg = choice.message ?? {};
  const toolCalls = parseToolCalls(msg.tool_calls);
  const content = typeof msg.content === "string" ? msg.content : "";

  const secs = Math.round((Date.now() - t0) / 1000);
  const usage = json.usage ?? {};
  const reasoning = usage.completion_tokens_details?.reasoning_tokens;
  console.log(
    `[llm:${req.label}] réponse en ${secs}s` +
      (usage.completion_tokens != null ? ` — ${usage.completion_tokens} tokens de sortie` : "") +
      (reasoning != null ? ` (dont ${reasoning} de raisonnement)` : "") +
      (choice.finish_reason === "length" ? " ⚠️ tronquée (max_tokens)" : "")
  );

  return {
    role: "assistant",
    content,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    // Rien à rejouer : ce dialecte accepte qu'on lui renvoie le message pivot.
  };
}

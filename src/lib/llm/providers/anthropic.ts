/**
 * Anthropic — API Messages (/v1/messages).
 *
 * C'est la traduction la plus éloignée du pivot :
 * - le prompt système est un champ à part, pas un message ;
 * - les appels d'outils sont des blocs `tool_use` dans le contenu assistant,
 *   et les résultats des blocs `tool_result` dans un message **user** ;
 * - `max_tokens` est obligatoire ;
 * - les rôles doivent alterner, donc plusieurs réponses d'outils consécutives
 *   se regroupent dans un seul message.
 *
 * Le raisonnement étendu produit des blocs `thinking` signés qu'il faut
 * renvoyer intacts au tour suivant : d'où le `_raw` sur le message assistant.
 */

import { LlmError } from "../types";
import type { LlmMessage, LlmToolCall, ReasoningEffort, ResolvedRequest } from "../types";
import { joinUrl, postJson, readSse } from "../http";

const API_VERSION = "2023-06-01";

/**
 * Effort OpenAI → budget de raisonnement Anthropic (en tokens).
 * `none` désactive complètement ; le minimum accepté par l'API est 1024.
 */
const THINKING_BUDGET: Record<ReasoningEffort, number> = {
  none: 0,
  low: 2_048,
  medium: 6_000,
  high: 12_000,
  xhigh: 24_000,
  max: 32_000,
};

type Block = Record<string, any>;

/** Découpe le pivot en (system, messages natifs). */
function split(messages: LlmMessage[]): { system: string; native: Block[] } {
  const systems: string[] = [];
  const native: Block[] = [];

  const push = (role: "user" | "assistant", content: Block[]) => {
    if (content.length === 0) return;
    const last = native[native.length - 1];
    // Les rôles doivent alterner : on fusionne au lieu d'empiler.
    if (last && last.role === role) last.content.push(...content);
    else native.push({ role, content });
  };

  for (const m of messages) {
    if (m.role === "system") {
      const text = String(m.content ?? "").trim();
      if (text) systems.push(text);
      continue;
    }
    if (m.role === "tool") {
      push("user", [
        {
          type: "tool_result",
          tool_use_id: m.tool_call_id,
          content: String(m.content ?? ""),
        },
      ]);
      continue;
    }
    if (m.role === "assistant") {
      // Rejeu à l'identique : conserve les blocs `thinking` et leur signature,
      // exigés dès qu'un tool_use suit un raisonnement.
      if (m._raw?.provider === "anthropic" && Array.isArray(m._raw.items)) {
        push("assistant", m._raw.items as Block[]);
        continue;
      }
      const blocks: Block[] = [];
      const text = String(m.content ?? "").trim();
      if (text) blocks.push({ type: "text", text });
      for (const c of m.tool_calls ?? []) {
        blocks.push({
          type: "tool_use",
          id: c.id,
          name: c.function.name,
          input: safeParse(c.function.arguments),
        });
      }
      push("assistant", blocks);
      continue;
    }
    const text = String(m.content ?? "").trim();
    if (text) push("user", [{ type: "text", text }]);
  }

  return { system: systems.join("\n\n"), native };
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** Outil pivot → schéma Anthropic (input_schema au lieu de parameters). */
function toAnthropicTool(t: unknown): Block {
  const tool = t as Record<string, any>;
  const fn = tool?.function ?? tool;
  return {
    name: fn.name,
    description: fn.description ?? "",
    input_schema: fn.parameters ?? { type: "object", properties: {} },
  };
}

/**
 * Réassemble les blocs de contenu d'un flux SSE Anthropic.
 * Les arguments d'outil arrivent en fragments de JSON (`input_json_delta`)
 * qu'il faut concaténer avant de parser.
 */
type Assembler = { blocks: Block[]; partialJson: string[] };

function applyEvent(a: Assembler, evt: Record<string, any>, label: string): void {
  const type = String(evt.type || "");
  const i = typeof evt.index === "number" ? evt.index : 0;

  if (type === "content_block_start") {
    a.blocks[i] = { ...(evt.content_block ?? {}) };
    a.partialJson[i] = "";
  } else if (type === "content_block_delta") {
    const d = evt.delta ?? {};
    const b = (a.blocks[i] ??= {});
    if (d.type === "text_delta") b.text = (b.text ?? "") + d.text;
    else if (d.type === "thinking_delta") b.thinking = (b.thinking ?? "") + d.thinking;
    else if (d.type === "signature_delta") b.signature = (b.signature ?? "") + d.signature;
    else if (d.type === "input_json_delta") {
      a.partialJson[i] = (a.partialJson[i] ?? "") + (d.partial_json ?? "");
    }
  } else if (type === "content_block_stop") {
    const b = a.blocks[i];
    if (b?.type === "tool_use") b.input = safeParse(a.partialJson[i] || "{}");
    if (b?.type === "thinking" && b.thinking) {
      console.log(`[llm:${label}] 💭 ${String(b.thinking).replace(/\n+/g, " ").slice(0, 400)}`);
    }
  } else if (type === "error") {
    throw new LlmError(
      String(evt.error?.message || "Erreur de flux").slice(0, 300),
      "api",
      undefined,
      "Anthropic",
      true
    );
  }
}

export async function anthropicMessages(req: ResolvedRequest): Promise<LlmMessage> {
  const { provider } = req;
  const { system, native } = split(req.messages);

  if (native.length === 0) {
    throw new LlmError("Aucun message à envoyer", "config", undefined, provider.label);
  }

  const budget = THINKING_BUDGET[req.effort] ?? 0;
  const thinking = budget > 0;
  // max_tokens doit dépasser le budget de raisonnement, et laisser de la place
  // à la réponse elle-même.
  const maxTokens = thinking ? Math.max(req.maxTokens, budget + 4_096) : req.maxTokens;

  // Pas de mode JSON natif : on l'obtient par instruction (parseJsonLoose
  // sait de toute façon extraire l'objet d'un texte qui l'entoure).
  const systemText = req.json
    ? `${system}\n\nRéponds UNIQUEMENT avec un objet JSON valide, sans texte ni balises autour.`.trim()
    : system;

  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: maxTokens,
    messages: native,
    stream: true,
  };
  if (systemText) body.system = systemText;
  if (thinking) body.thinking = { type: "enabled", budget_tokens: budget };
  if (req.tools?.length) {
    body.tools = req.tools.map(toAnthropicTool);
    // Le raisonnement étendu interdit de forcer un outil : on retombe sur auto.
    const choice = req.toolChoice ?? "auto";
    body.tool_choice =
      choice === "required" && !thinking
        ? { type: "any" }
        : { type: choice === "none" ? "none" : "auto" };
  }

  const t0 = Date.now();
  console.log(
    `[llm:${req.label}] ${provider.label} · ${req.model}` +
      (thinking ? ` (raisonnement ${budget} tokens)` : "") +
      "…"
  );

  const res = await postJson(
    joinUrl(req.baseUrl, "/messages"),
    { "x-api-key": req.apiKey, "anthropic-version": API_VERSION },
    body,
    provider.label
  );

  const asm: Assembler = { blocks: [], partialJson: [] };
  let stopReason = "";
  let outputTokens: number | undefined;
  await readSse(
    res,
    (evt) => {
      if (evt.type === "message_delta") {
        stopReason = String(evt.delta?.stop_reason ?? stopReason);
        outputTokens = evt.usage?.output_tokens ?? outputTokens;
      } else {
        applyEvent(asm, evt, req.label);
      }
    },
    provider.label
  );

  const blocks = asm.blocks.filter(Boolean);
  if (blocks.length === 0) {
    throw new LlmError("Réponse vide du modèle", "api", undefined, provider.label, true);
  }

  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(
    `[llm:${req.label}] réponse en ${secs}s` +
      (outputTokens != null ? ` — ${outputTokens} tokens de sortie` : "") +
      (stopReason === "max_tokens" ? " ⚠️ tronquée (max_tokens)" : "")
  );

  const content = blocks
    .filter((b) => b.type === "text")
    .map((b) => String(b.text ?? ""))
    .join("");

  const toolCalls: LlmToolCall[] = blocks
    .filter((b) => b.type === "tool_use")
    .map((b) => ({
      id: String(b.id),
      function: { name: String(b.name), arguments: JSON.stringify(b.input ?? {}) },
    }));

  return {
    role: "assistant",
    content,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    _raw: { provider: "anthropic", items: blocks },
  };
}

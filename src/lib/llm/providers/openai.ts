/**
 * OpenAI — API Responses (/v1/responses), pas /chat/completions.
 *
 * Sur la famille GPT-5.6, les function tools combinés au raisonnement ne sont
 * supportés que sur cette API. Elle a son propre vocabulaire (items d'input,
 * function_call plate, text.format) : toute la traduction est ici.
 *
 * L'appel est fait en streaming pour l'observabilité : les résumés de
 * raisonnement (l'API n'expose jamais la chaîne de pensée brute) s'impriment au
 * fil de l'eau dans la console serveur.
 */

import { LlmError } from "../types";
import type { LlmMessage, ResolvedRequest } from "../types";
import { joinUrl, postJson, readSse } from "../http";

/**
 * messages (pivot) → items d'input de l'API Responses.
 *
 * - Un message assistant produit par ce provider porte `_raw` : on rejoue ces
 *   items bruts tels quels (reasoning + function_call + message) — l'API exige
 *   qu'un function_call soit accompagné de son item de raisonnement.
 * - Un message role:"tool" devient un function_call_output.
 * - Le reste (system/user/assistant texte) passe tel quel.
 */
function toInputItems(messages: LlmMessage[]): unknown[] {
  const items: unknown[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      items.push({
        type: "function_call_output",
        call_id: m.tool_call_id,
        output: String(m.content ?? ""),
      });
    } else if (
      m.role === "assistant" &&
      m._raw?.provider === "openai" &&
      Array.isArray(m._raw.items)
    ) {
      items.push(...m._raw.items);
    } else if (m.role === "assistant" && m.tool_calls?.length) {
      // Message venu d'un autre provider : on reconstruit sans raisonnement.
      if (m.content) items.push({ role: "assistant", content: String(m.content) });
      for (const c of m.tool_calls) {
        items.push({
          type: "function_call",
          call_id: c.id,
          name: c.function.name,
          arguments: c.function.arguments || "{}",
        });
      }
    } else {
      items.push({ role: m.role, content: String(m.content ?? "") });
    }
  }
  return items;
}

/** Outil pivot ({type,function:{…}}) → format Responses (aplati). */
function toResponsesTool(t: unknown): unknown {
  const tool = t as Record<string, any>;
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
 * Les résumés de raisonnement ne sont pas disponibles sur toutes les orgs ni
 * tous les modèles : en cas de 400 les mentionnant, on les coupe et on retente
 * sans. L'état vit au niveau du module d'appel, pas de la tentative.
 */
export async function openaiResponses(req: ResolvedRequest): Promise<LlmMessage> {
  const { provider } = req;
  let withSummary = true;

  // withRetries est appliqué par le registre ; ici on gère le repli « summary »
  // en relançant explicitement une fois.
  for (let pass = 0; pass < 2; pass++) {
    const body: Record<string, unknown> = {
      model: req.model,
      input: toInputItems(req.messages),
      reasoning: withSummary
        ? { effort: req.effort, summary: "auto" }
        : { effort: req.effort },
      stream: true,
    };
    if (req.tools?.length) {
      body.tools = req.tools.map(toResponsesTool);
      body.tool_choice = req.toolChoice ?? "auto";
    }
    if (req.json) body.text = { format: { type: "json_object" } };

    const t0 = Date.now();
    console.log(
      `[llm:${req.label}] ${provider.label} · ${req.model} (effort ${req.effort})…`
    );

    let res: Response;
    try {
      res = await postJson(
        joinUrl(req.baseUrl, "/responses"),
        { Authorization: `Bearer ${req.apiKey}` },
        body,
        provider.label
      );
    } catch (err) {
      if (
        err instanceof LlmError &&
        err.status === 400 &&
        withSummary &&
        /summary/i.test(err.message)
      ) {
        console.warn(
          `[llm:${req.label}] résumés de raisonnement indisponibles — désactivés`
        );
        withSummary = false;
        continue;
      }
      throw err;
    }

    // Lecture du flux : résumés imprimés, réponse finale collectée.
    let final: Record<string, any> | null = null;
    await readSse(
      res,
      (evt) => {
        const type = String(evt.type || "");
        if (type === "response.reasoning_summary_part.done") {
          const text = evt.part?.text;
          if (text) console.log(`[llm:${req.label}] 💭 ${String(text).replace(/\n+/g, " ")}`);
        } else if (
          type === "response.completed" ||
          type === "response.incomplete" ||
          type === "response.failed"
        ) {
          final = evt.response ?? null;
        } else if (type === "error") {
          throw new LlmError(
            String(evt.message || "Erreur de flux").slice(0, 300),
            "api",
            undefined,
            provider.label,
            true
          );
        }
      },
      provider.label
    );

    // TS ne voit pas l'assignation faite dans la closure de readSse.
    const resp = final as Record<string, any> | null;
    if (!resp) {
      throw new LlmError(
        "Flux terminé sans réponse complète",
        "api",
        undefined,
        provider.label,
        true
      );
    }
    if (resp.status === "failed" || resp.error) {
      throw new LlmError(
        String(resp.error?.message || "Échec de la réponse").slice(0, 300),
        "api",
        undefined,
        provider.label
      );
    }
    if (resp.status === "incomplete") {
      console.warn(
        `[llm:${req.label}] réponse incomplète (${resp.incomplete_details?.reason || "raison inconnue"})`
      );
    }

    const output: Record<string, any>[] = Array.isArray(resp.output) ? resp.output : [];
    if (output.length === 0) {
      throw new LlmError("Réponse vide du modèle", "api", undefined, provider.label, true);
    }

    const secs = Math.round((Date.now() - t0) / 1000);
    const reasoningTokens = resp.usage?.output_tokens_details?.reasoning_tokens;
    const outputTokens = resp.usage?.output_tokens;
    console.log(
      `[llm:${req.label}] réponse en ${secs}s` +
        (reasoningTokens != null
          ? ` — ${reasoningTokens} tokens de raisonnement / ${outputTokens} tokens de sortie`
          : "")
    );

    const content = output
      .filter((i) => i.type === "message")
      .flatMap((i) => (Array.isArray(i.content) ? i.content : []))
      .filter((c: Record<string, any>) => c.type === "output_text")
      .map((c: Record<string, any>) => c.text)
      .join("");

    const toolCalls = output
      .filter((i) => i.type === "function_call")
      .map((i) => ({
        id: String(i.call_id),
        function: { name: String(i.name), arguments: String(i.arguments ?? "{}") },
      }));

    return {
      role: "assistant",
      content,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      _raw: { provider: "openai", items: output },
    };
  }

  throw new LlmError("Échec de l'appel Responses", "api", undefined, provider.label);
}

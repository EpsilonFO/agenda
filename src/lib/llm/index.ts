/**
 * Point d'entrée unique de la couche LLM.
 *
 * Le reste de l'application n'importe que ce fichier et ne sait pas quel
 * fournisseur tourne : elle envoie des messages au format chat-completions et
 * récupère un message du même format. Changer de modèle = changer
 * LLM_PROVIDER dans .env.local, rien d'autre.
 *
 *   LLM_PROVIDER=openai      → GPT (API Responses, raisonnement + outils)
 *   LLM_PROVIDER=claude      → Anthropic (API Messages, raisonnement étendu)
 *   LLM_PROVIDER=mistral     → Mistral
 *   LLM_PROVIDER=deepseek    → DeepSeek
 *   LLM_PROVIDER=openai-compat → n'importe quel endpoint /chat/completions
 *                                (Ollama, Groq, OpenRouter…) via LLM_BASE_URL
 */

import { LlmError } from "./types";
import type { ChatRequest, LlmMessage, ResolvedRequest } from "./types";
import {
  deliberationEffort,
  getApiKey,
  getBaseUrl,
  getMaxTokens,
  getModel,
  getProvider,
  normalizeEffort,
} from "./env";
import { withRetries } from "./http";

export { LlmError } from "./types";
export type {
  ChatRequest,
  LlmMessage,
  LlmToolCall,
  LlmToolDef,
  ProviderId,
  ReasoningEffort,
} from "./types";
export {
  MODELS,
  chatEffort,
  deliberationEffort,
  describeLlmConfig,
  getProvider,
  retouchEffort,
} from "./env";
export type { ModelRole } from "./env";
export { PROVIDERS, PROVIDER_NAMES } from "./providers";

/**
 * Un aller-retour avec le modèle actif.
 *
 * Résout la config, délègue au provider, retente les erreurs transitoires
 * (429/5xx, réseau, timeout). Les erreurs remontent toujours en `LlmError`,
 * avec `kind` exploitable par l'appelant (`no-key`, `config`, `api`, `timeout`).
 *
 * Le message renvoyé peut porter un champ `_raw` : la réponse native du
 * provider, à rejouer telle quelle si on le remet dans l'historique (items de
 * raisonnement OpenAI, blocs `thinking` signés d'Anthropic). Le reste du code
 * n'a pas à s'en occuper — il suffit de repousser le message tel quel.
 */
export async function llmChat(opts: ChatRequest): Promise<LlmMessage> {
  const provider = getProvider();
  const apiKey = getApiKey(provider);
  const baseUrl = getBaseUrl(provider);
  const model = opts.model || getModel("small", provider);
  const label = opts.label || model;

  if (opts.tools?.length && !provider.capabilities.tools) {
    throw new LlmError(
      `${provider.label} ne gère pas les appels d'outils : l'agent ne peut pas tourner sur ce fournisseur.`,
      "config",
      undefined,
      provider.label
    );
  }

  const req: ResolvedRequest = {
    ...opts,
    provider,
    model,
    apiKey,
    baseUrl,
    label,
    effort: normalizeEffort(opts.effort) ?? deliberationEffort(),
    maxTokens: getMaxTokens(),
  };

  return withRetries(label, () => provider.chat(req));
}

/** Extrait et parse le premier objet JSON d'un texte de modèle. */
export function parseJsonLoose<T>(text: string): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    // Les modèles sans mode JSON natif encadrent souvent l'objet de texte ou
    // de balises ```json : on récupère le plus grand bloc accoladé.
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

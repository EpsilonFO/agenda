/**
 * Catalogue des providers. Ajouter un fournisseur = ajouter une entrée ici,
 * et rien d'autre : les valeurs par défaut, les noms de variables d'env et
 * les capacités sont déclarés au même endroit que la fonction d'appel.
 */

import type { ProviderId, ProviderSpec } from "../types";
import { openaiResponses } from "./openai";
import { anthropicMessages } from "./anthropic";
import { chatCompletions } from "./chat-completions";

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    aliases: ["chatgpt", "gpt"],
    apiKeyEnv: "OPENAI_API_KEY",
    modelEnv: "OPENAI_MODEL",
    baseUrlEnv: "OPENAI_BASE_URL",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5.6-terra",
    keyUrl: "https://platform.openai.com/api-keys",
    capabilities: { tools: true, jsonMode: true, reasoning: true },
    chat: openaiResponses,
  },

  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    aliases: ["claude"],
    apiKeyEnv: "ANTHROPIC_API_KEY",
    modelEnv: "ANTHROPIC_MODEL",
    baseUrlEnv: "ANTHROPIC_BASE_URL",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-5",
    keyUrl: "https://console.anthropic.com/settings/keys",
    // Pas de response_format : le JSON s'obtient par instruction (voir le provider).
    capabilities: { tools: true, jsonMode: false, reasoning: true },
    chat: anthropicMessages,
  },

  mistral: {
    id: "mistral",
    label: "Mistral",
    aliases: ["mistralai"],
    apiKeyEnv: "MISTRAL_API_KEY",
    modelEnv: "MISTRAL_MODEL",
    baseUrlEnv: "MISTRAL_BASE_URL",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-large-latest",
    keyUrl: "https://console.mistral.ai/api-keys",
    // Pas de paramètre d'effort : il est ignoré côté provider.
    capabilities: { tools: true, jsonMode: true, reasoning: false },
    chat: chatCompletions,
  },

  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    aliases: [],
    apiKeyEnv: "DEEPSEEK_API_KEY",
    modelEnv: "DEEPSEEK_MODEL",
    baseUrlEnv: "DEEPSEEK_BASE_URL",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    // deepseek-reasoner raisonne mieux mais n'accepte ni outils ni mode JSON :
    // deepseek-chat est le seul défaut compatible avec l'agent.
    defaultModel: "deepseek-chat",
    keyUrl: "https://platform.deepseek.com/api_keys",
    capabilities: { tools: true, jsonMode: true, reasoning: false },
    chat: chatCompletions,
  },

  /**
   * Tout endpoint parlant le dialecte /chat/completions : Ollama, Groq,
   * OpenRouter, vLLM, LM Studio… Il faut renseigner LLM_BASE_URL et LLM_MODEL ;
   * la clé est facultative (serveur local).
   */
  "openai-compat": {
    id: "openai-compat",
    label: "OpenAI-compatible",
    aliases: [
      // Type de déploiement…
      "compat",
      "custom",
      "local",
      "localmodel",
      // …serveur…
      "ollama",
      "groq",
      "openrouter",
      "together",
      // …ou famille de modèle : commodité, le modèle reste à donner
      // séparément (LLM_PROVIDER=qwen n'implique pas LLM_MODEL).
      "qwen",
    ],
    apiKeyEnv: "LLM_API_KEY",
    modelEnv: "LLM_MODEL",
    baseUrlEnv: "LLM_BASE_URL",
    defaultBaseUrl: "",
    defaultModel: "",
    requiresKey: false,
    capabilities: { tools: true, jsonMode: true, reasoning: false },
    chat: chatCompletions,
  },
};

/** Liste des valeurs acceptées par LLM_PROVIDER (ids + alias). */
export const PROVIDER_NAMES: string[] = Object.values(PROVIDERS).flatMap((p) => [
  p.id,
  ...p.aliases,
]);

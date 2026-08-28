/**
 * Types partagés de la couche LLM.
 *
 * Le format PIVOT interne est celui de chat-completions (messages + tool_calls) :
 * c'est le plus courant, et l'application entière ne connaît que celui-là.
 * Chaque provider traduit pivot → format natif à l'aller, et natif → pivot au
 * retour. Aucune trace du provider ne remonte dans le reste du code.
 */

/** Identifiants canoniques (les alias — claude, chatgpt… — sont résolus dans env.ts). */
export type ProviderId =
  | "openai"
  | "anthropic"
  | "mistral"
  | "deepseek"
  | "openai-compat";

/** Message au format pivot. */
export type LlmMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  /** Appels d'outils demandés par l'assistant. */
  tool_calls?: LlmToolCall[];
  /** Sur un message role:"tool" : l'id de l'appel auquel il répond. */
  tool_call_id?: string;
  /** Nom de l'outil (informatif). */
  name?: string;
  /**
   * Réponse native brute du provider qui a produit ce message, à rejouer telle
   * quelle si on le renvoie dans l'historique. Indispensable pour OpenAI (items
   * de raisonnement) et Anthropic (blocs `thinking` signés), qui refusent un
   * appel d'outil détaché de son raisonnement.
   *
   * Étiqueté par provider : si on change de provider en cours de conversation,
   * le bloc est ignoré et le message est reconstruit en texte + tool_calls.
   */
  _raw?: { provider: ProviderId; items: unknown };
};

export type LlmToolCall = {
  id: string;
  function: { name: string; arguments: string };
};

/** Outil au format pivot (chat-completions). */
export type LlmToolDef = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

/**
 * Effort de raisonnement, vocabulaire OpenAI. Chaque provider le traduit dans
 * son propre paramètre (budget de tokens chez Anthropic) ou l'ignore.
 */
export type ReasoningEffort =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

/** Requête telle que l'appelant la formule. */
export type ChatRequest = {
  /** Modèle. Vide = modèle par défaut du provider actif. */
  model?: string;
  messages: LlmMessage[];
  tools?: LlmToolDef[];
  toolChoice?: "auto" | "none" | "required";
  /** Force une réponse JSON. */
  json?: boolean;
  /** Étiquette pour les logs (nom de l'agent) — défaut : le modèle. */
  label?: string;
  /** Effort de raisonnement — défaut : celui de la délibération. */
  effort?: string;
};

/** Requête après résolution de l'environnement — ce que reçoit un provider. */
export type ResolvedRequest = ChatRequest & {
  provider: ProviderSpec;
  model: string;
  apiKey: string;
  baseUrl: string;
  label: string;
  effort: ReasoningEffort;
  maxTokens: number;
};

export type ProviderCapabilities = {
  /** Function calling natif. */
  tools: boolean;
  /** Mode JSON natif (response_format / text.format). */
  jsonMode: boolean;
  /** Paramètre de raisonnement explicite. */
  reasoning: boolean;
};

export type ProviderSpec = {
  id: ProviderId;
  /** Nom lisible, utilisé dans les logs et les messages d'erreur. */
  label: string;
  /** Alias acceptés dans LLM_PROVIDER (en plus de l'id). */
  aliases: string[];
  /** Variable d'env portant la clé API. */
  apiKeyEnv: string;
  /** Variable d'env portant le modèle par défaut. */
  modelEnv: string;
  /** Variable d'env permettant de surcharger l'URL de base. */
  baseUrlEnv: string;
  defaultBaseUrl: string;
  defaultModel: string;
  /** Où récupérer une clé (affiché quand elle manque). */
  keyUrl?: string;
  /** Une clé API est-elle exigée ? (false pour un serveur local type Ollama.) */
  requiresKey?: boolean;
  capabilities: ProviderCapabilities;
  /** Un aller-retour complet, déjà retenté en cas d'erreur transitoire. */
  chat: (req: ResolvedRequest) => Promise<LlmMessage>;
};

/** Erreur unifiée, quel que soit le provider. */
export class LlmError extends Error {
  constructor(
    message: string,
    public kind: "no-key" | "config" | "api" | "timeout" = "api",
    public status?: number,
    public provider?: string,
    /** L'appelant peut-il retenter ? (429/5xx, réseau, timeout) */
    public retryable = false
  ) {
    super(message);
    this.name = "LlmError";
  }
}

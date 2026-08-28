/**
 * Résolution de la configuration LLM depuis l'environnement.
 *
 * Un seul levier suffit à tout changer : LLM_PROVIDER. Le modèle, l'URL de
 * base et le nom de la variable de clé en découlent. Tout le reste (modèle par
 * rôle, effort de raisonnement, budget de sortie) n'est là que pour affiner.
 *
 * Lecture paresseuse : rien n'est figé à l'import, ce qui rend la couche
 * testable et insensible à l'ordre de chargement de dotenv par Next.
 */

import { LlmError } from "./types";
import type { ProviderSpec, ReasoningEffort } from "./types";
import { PROVIDERS, PROVIDER_NAMES } from "./providers";

const EFFORTS: ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh", "max"];

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

/** Provider actif. Erreur explicite (et non repli silencieux) si le nom est inconnu. */
export function getProvider(): ProviderSpec {
  const raw = (env("LLM_PROVIDER") || "openai").toLowerCase();
  const found = Object.values(PROVIDERS).find(
    (p) => p.id === raw || p.aliases.includes(raw)
  );
  if (!found) {
    throw new LlmError(
      `LLM_PROVIDER="${raw}" inconnu. Valeurs acceptées : ${PROVIDER_NAMES.join(", ")}.`,
      "config"
    );
  }
  return found;
}

/** Clé API du provider actif. */
export function getApiKey(p: ProviderSpec = getProvider()): string {
  const key = env(p.apiKeyEnv);
  if (!key && p.requiresKey !== false) {
    throw new LlmError(
      `Clé API ${p.label} manquante : renseigne ${p.apiKeyEnv} dans .env.local` +
        (p.keyUrl ? ` (clé à récupérer sur ${p.keyUrl})` : "") +
        ".",
      "no-key",
      undefined,
      p.label
    );
  }
  return key ?? "";
}

/** URL de base du provider actif (surchargeable par env). */
export function getBaseUrl(p: ProviderSpec = getProvider()): string {
  const url = env(p.baseUrlEnv) || env("LLM_BASE_URL") || p.defaultBaseUrl;
  if (!url) {
    throw new LlmError(
      `URL de base manquante pour ${p.label} : renseigne ${p.baseUrlEnv}.`,
      "config",
      undefined,
      p.label
    );
  }
  return url;
}

/** Rôles ayant leur propre modèle (surchargeables un par un). */
export type ModelRole = "small" | "planner" | "coach" | "work" | "leisure" | "chef";

const ROLE_ENV: Record<ModelRole, string> = {
  small: "SMALL",
  planner: "PLANNER",
  coach: "COACH",
  work: "WORK",
  leisure: "LEISURE",
  chef: "CHEF",
};

/**
 * Modèle d'un rôle, par ordre de priorité :
 *   LLM_MODEL_<RÔLE> → OPENAI_MODEL_<RÔLE> (hérité, OpenAI seulement)
 *   → LLM_MODEL → <PROVIDER>_MODEL → défaut du provider.
 */
export function getModel(role: ModelRole = "small", p: ProviderSpec = getProvider()): string {
  const suffix = ROLE_ENV[role];
  const model =
    env(`LLM_MODEL_${suffix}`) ||
    (p.id === "openai" ? env(`OPENAI_MODEL_${suffix}`) : undefined) ||
    env("LLM_MODEL") ||
    env(p.modelEnv) ||
    p.defaultModel;

  if (!model) {
    throw new LlmError(
      `Aucun modèle pour ${p.label} : renseigne ${p.modelEnv}` +
        (p.modelEnv === "LLM_MODEL" ? "." : " (ou LLM_MODEL)."),
      "config",
      undefined,
      p.label
    );
  }
  return model;
}

/**
 * Table des modèles par rôle. Getters : la valeur est relue à chaque accès,
 * donc changer .env.local et relancer suffit — aucun cache à invalider.
 */
export const MODELS: Record<ModelRole, string> = {
  get small() {
    return getModel("small");
  },
  /** Josiane (agenda) : raisonnement spatio-temporel & arbitrage. */
  get planner() {
    return getModel("planner");
  },
  /** Jannik (coach sportif). */
  get coach() {
    return getModel("coach");
  },
  /** Emilien (travail). */
  get work() {
    return getModel("work");
  },
  /** Djimo (loisir). */
  get leisure() {
    return getModel("leisure");
  },
  /** Simone (cheffe cuisinière). */
  get chef() {
    return getModel("chef");
  },
};

function effort(...names: string[]): ReasoningEffort | undefined {
  for (const n of names) {
    const v = env(n)?.toLowerCase();
    if (!v) continue;
    if ((EFFORTS as string[]).includes(v)) return v as ReasoningEffort;
    console.warn(`[llm] ${n}="${v}" invalide — valeurs : ${EFFORTS.join("|")}. Ignoré.`);
  }
  return undefined;
}

/**
 * Effort des appels de DÉLIBÉRATION (Conseil, planner) : ce sont eux qui
 * arbitrent sous contraintes, ils méritent de réfléchir.
 */
export function deliberationEffort(): ReasoningEffort {
  return effort("LLM_REASONING_EFFORT", "OPENAI_REASONING_EFFORT") || "xhigh";
}

/**
 * Effort de la BOUCLE DE CHAT (routage d'outils + rédaction de la réponse).
 * Volontairement bien plus bas : ces tours-là choisissent un outil et écrivent
 * deux phrases en français. À xhigh ils coûtaient chacun des dizaines de
 * milliers de tokens de raisonnement, et la boucle en enchaîne 3 à 5 — c'est ce
 * qui faisait des réponses à plusieurs minutes sur une demande simple.
 */
export function chatEffort(): ReasoningEffort {
  return effort("LLM_REASONING_EFFORT_CHAT", "OPENAI_REASONING_EFFORT_CHAT") || "medium";
}

/**
 * Effort de la RETOUCHE ciblée d'un plan (`replan_week`). Entre les deux :
 * déplacer une session en vérifiant qu'elle ne casse rien est un problème bien
 * plus petit qu'arbitrer une semaine entière depuis zéro — xhigh y partait en
 * boucle plutôt qu'en convergence.
 */
export function retouchEffort(): ReasoningEffort {
  return effort("LLM_REASONING_EFFORT_RETOUCH", "OPENAI_REASONING_EFFORT_RETOUCH") || "high";
}

/** Normalise une valeur d'effort venue d'un appelant. */
export function normalizeEffort(value: string | undefined): ReasoningEffort | undefined {
  const v = value?.toLowerCase();
  return v && (EFFORTS as string[]).includes(v) ? (v as ReasoningEffort) : undefined;
}

/** Plafond de tokens de sortie (obligatoire chez Anthropic, facultatif ailleurs). */
export function getMaxTokens(): number {
  return Number(env("LLM_MAX_TOKENS")) || 8_192;
}

/** Résumé une ligne de la config active, pour les logs de démarrage. */
export function describeLlmConfig(): string {
  try {
    const p = getProvider();
    const hasKey = Boolean(env(p.apiKeyEnv));
    return (
      `${p.label} · ${getModel("small", p)}` +
      (getModel("planner", p) !== getModel("small", p)
        ? ` (planner : ${getModel("planner", p)})`
        : "") +
      ` · effort ${deliberationEffort()}/${chatEffort()}` +
      (hasKey || p.requiresKey === false ? "" : ` · ⚠️ ${p.apiKeyEnv} absente`)
    );
  } catch (err) {
    return `⚠️ ${err instanceof Error ? err.message : String(err)}`;
  }
}

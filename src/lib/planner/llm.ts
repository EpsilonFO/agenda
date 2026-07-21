/**
 * Appel LLM sous contrat : la réponse DOIT valider un schéma zod.
 *
 * En cas de JSON invalide ou non conforme, on renvoie les erreurs au modèle
 * et on retente (maxRetries fois). Au-delà, on lève — l'orchestrateur décide
 * quoi faire. Jamais de parse silencieux qui devient un plan vide.
 */

import type { ZodType } from "zod";
import { mistralChat } from "../mistral";
import { parseJsonLoose } from "../mistral";

/** Signature minimale d'un appel chat (injectable dans les tests). */
export type ChatFn = (opts: {
  model: string;
  messages: Record<string, unknown>[];
  temperature?: number;
  json?: boolean;
}) => Promise<Record<string, any>>;

export class AgentOutputError extends Error {
  constructor(
    public agent: string,
    public attempts: number,
    public lastIssues: string
  ) {
    super(
      `Sortie invalide de ${agent} après ${attempts} tentative(s) :\n${lastIssues}`
    );
  }
}

export type CallJsonOptions = {
  /** Nom de l'agent (pour les erreurs/logs). */
  agent: string;
  model: string;
  system: string;
  user: string;
  temperature?: number;
  /** Nombre de RETRIES après le premier essai (défaut 2). */
  maxRetries?: number;
  /** Implémentation de chat (défaut : mistralChat). */
  chat?: ChatFn;
};

/**
 * Appelle le modèle et renvoie un objet validé par `schema`.
 * Retry avec feedback d'erreurs en cas de sortie non conforme.
 */
export async function callJson<T>(
  schema: ZodType<T>,
  opts: CallJsonOptions
): Promise<T> {
  const chat = opts.chat ?? (mistralChat as ChatFn);
  const maxRetries = opts.maxRetries ?? 2;

  const messages: Record<string, unknown>[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];

  let lastIssues = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const message = await chat({
      model: opts.model,
      messages,
      temperature: opts.temperature ?? 0.4,
      json: true,
    });
    const raw = String(message.content || "");

    const parsed = parseJsonLoose<unknown>(raw);
    if (parsed !== null) {
      const result = schema.safeParse(parsed);
      if (result.success) return result.data;
      lastIssues = result.error.issues
        .map((i) => `- ${i.path.join(".") || "(racine)"} : ${i.message}`)
        .join("\n");
    } else {
      lastIssues = "- la réponse n'est pas du JSON parsable";
    }

    // Feedback d'erreur pour la tentative suivante.
    messages.push({ role: "assistant", content: raw });
    messages.push({
      role: "user",
      content: `Ta réponse ne respecte pas le format attendu :\n${lastIssues}\nRenvoie UNIQUEMENT l'objet JSON corrigé, sans texte autour.`,
    });
  }

  throw new AgentOutputError(opts.agent, maxRetries + 1, lastIssues);
}

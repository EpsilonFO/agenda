/**
 * Résumé automatique de l'historique de conversation.
 *
 * Quand le nombre de messages d'un mode dépasse SUMMARY_THRESHOLD, on demande
 * à Mistral de produire un résumé compact des échanges passés. Ce résumé est
 * stocké comme un message de role "summary" en tête de l'historique persisté,
 * et injecté dans le contexte système de l'agent à chaque appel.
 *
 * Objectif : garder un contexte utile sans envoyer 100 messages à l'API.
 */

import { MODELS, mistralChat } from "./mistral";
import {
  getChatHistory,
  setChatHistory,
  CHAT_HISTORY_MAX,
} from "./store";
import type { ChatHistoryEntry } from "./types";

/** Déclenche un résumé quand on dépasse ce seuil de messages réguliers. */
const SUMMARY_THRESHOLD = 40;

/**
 * Construit le bloc de contexte "mémoire de conversation" à injecter dans le
 * system prompt de l'agent. Retourne une chaîne vide si l'historique est vide.
 */
export async function buildConversationContext(mode: string): Promise<string> {
  const history = await getChatHistory(mode);
  if (history.length === 0) return "";

  const summary = history.find((e) => e.role === "summary");
  const regular = history.filter((e) => e.role !== "summary");

  const parts: string[] = [];

  if (summary) {
    parts.push(`RÉSUMÉ DES ÉCHANGES PRÉCÉDENTS :\n${summary.content}`);
  }

  if (regular.length > 0) {
    const lines = regular
      .slice(-20) // les 20 derniers messages seulement dans le contexte
      .map((e) => `${e.role === "user" ? "Utilisateur" : "Assistant"}: ${e.content}`)
      .join("\n");
    parts.push(`DERNIERS ÉCHANGES :\n${lines}`);
  }

  if (parts.length === 0) return "";
  return `\n\n--- MÉMOIRE DE CONVERSATION ---\n${parts.join("\n\n")}\n--- FIN MÉMOIRE ---`;
}

/**
 * Vérifie si l'historique du mode dépasse le seuil et, si oui, génère un
 * résumé via Mistral puis compacte l'historique (résumé + 20 derniers msgs).
 */
export async function maybeSummarize(mode: string): Promise<void> {
  const history = await getChatHistory(mode);
  const regular = history.filter((e) => e.role !== "summary");

  if (regular.length < SUMMARY_THRESHOLD) return;

  // Les messages à résumer = tout sauf les 20 derniers (qu'on garde intacts).
  const toSummarize = regular.slice(0, -20);
  if (toSummarize.length === 0) return;

  const transcript = toSummarize
    .map((e) => `${e.role === "user" ? "Utilisateur" : "Assistant"}: ${e.content}`)
    .join("\n");

  try {
    const msg = await mistralChat({
      model: MODELS.small,
      messages: [
        {
          role: "system",
          content:
            "Tu es un assistant qui résume des conversations. Produis un résumé factuel et concis (10 lignes max) des échanges suivants, en retenant les décisions prises, préférences exprimées et actions effectuées sur l'agenda. Écris en français, au présent.",
        },
        {
          role: "user",
          content: `Résume cette conversation :\n\n${transcript}`,
        },
      ],
      temperature: 0.2,
    });

    const summaryText =
      typeof msg.content === "string" ? msg.content.trim() : "";
    if (!summaryText) return;

    const summaryEntry: ChatHistoryEntry = {
      role: "summary",
      content: summaryText,
      createdAt: new Date().toISOString(),
    };

    // Nouveau store : résumé + 20 derniers messages réguliers
    const kept = regular.slice(-20);
    await setChatHistory(mode, [summaryEntry, ...kept]);
  } catch (err) {
    // Résumé non critique — on continue sans planter
    console.warn("[summary] échec résumé automatique :", err);
  }
}

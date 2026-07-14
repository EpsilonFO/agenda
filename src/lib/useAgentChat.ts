"use client";

import { Dispatch, SetStateAction, useState } from "react";

export type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  actions?: string[];
};

export const CHAT_SUGGESTIONS = [
  "Bloque 2h de deep work demain matin",
  "Organise ma semaine : sport 3x, courses, dentiste jeudi",
  "Déplace ma réunion de 14h à jeudi",
];

const WELCOME: ChatMsg = {
  role: "assistant",
  content:
    "Bonjour 👋 Je gère ton agenda. Dis-moi ce que tu veux planifier, déplacer ou supprimer, et je m'occupe des créneaux.",
};

export type AgentChat = {
  messages: ChatMsg[];
  input: string;
  loading: boolean;
  setInput: Dispatch<SetStateAction<string>>;
  send: (text?: string) => Promise<void>;
};

/**
 * État partagé de la conversation avec l'agent.
 * Instancié une seule fois puis distribué aux vues bureau et mobile,
 * pour garder un historique unique quelle que soit la taille d'écran.
 */
export function useAgentChat(onChanged: () => void): AgentChat {
  const [messages, setMessages] = useState<ChatMsg[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    setInput("");

    const history = [...messages, { role: "user" as const, content }];
    setMessages(history);
    setLoading(true);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply || "…",
          actions: data.actions,
        },
      ]);
      if (data.changed) onChanged();
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "❌ Impossible de contacter l'agent." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return { messages, input, loading, setInput, send };
}

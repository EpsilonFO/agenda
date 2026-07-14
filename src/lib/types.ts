export type EventItem = {
  id: string;
  title: string;
  /** ISO 8601, ex: 2026-07-14T09:00:00 */
  start: string;
  /** ISO 8601 */
  end: string;
  description?: string;
  location?: string;
  /** Catégorie libre : "travail", "sport", "perso"... */
  category?: string;
  /** Couleur hex de la pastille, ex: #6366f1 */
  color?: string;
  createdAt: string;
  updatedAt: string;
};

export type MemoryItem = {
  id: string;
  content: string;
  createdAt: string;
};

export type ChatMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  /** présent pour role=assistant quand le modèle appelle des outils */
  tool_calls?: unknown;
  /** présent pour role=tool */
  tool_call_id?: string;
  name?: string;
};

export type AgentResponse = {
  reply: string;
  /** Résumé lisible des actions menées sur l'agenda */
  actions: string[];
  /** true si l'agenda a été modifié et doit être rechargé côté client */
  changed: boolean;
};

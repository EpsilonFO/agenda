import type { ChecklistItem } from "./types";

/**
 * Checklist d'un événement — les « choses à faire pendant » (appeler Ismael
 * pendant la séance Monumia). Elles vivent DANS l'événement : pas d'événement
 * voisin à caser à une heure précise, pas de créneau à défendre.
 *
 * Ce module normalise tout ce qui arrive du dehors (formulaire, API, LLM) :
 * une liste de chaînes comme une liste d'objets, avec des ids stables pour que
 * React et l'utilisateur suivent la même ligne quand le texte change.
 */

export const CHECKLIST_MAX_ITEMS = 30;
export const CHECKLIST_MAX_LEN = 240;

let seq = 0;

/** Id court et unique, utilisable côté serveur comme navigateur. */
export function newChecklistId(): string {
  seq = (seq + 1) % 1_000_000;
  return `c${Date.now().toString(36)}${seq.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

/** Crée une entrée à cocher à partir d'un texte libre. */
export function newChecklistItem(text: string): ChecklistItem {
  return { id: newChecklistId(), text: text.trim().slice(0, CHECKLIST_MAX_LEN), done: false };
}

function coerce(raw: unknown): ChecklistItem | null {
  if (typeof raw === "string") {
    const text = raw.trim();
    return text ? newChecklistItem(text) : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const text = typeof obj.text === "string" ? obj.text.trim() : "";
  if (!text) return null;
  const id = typeof obj.id === "string" && obj.id.trim() ? obj.id.trim().slice(0, 64) : newChecklistId();
  return { id, text: text.slice(0, CHECKLIST_MAX_LEN), done: obj.done === true };
}

/**
 * Normalise une checklist reçue du client ou d'un appel d'outil.
 * Accepte `["appeler Ismael"]` comme `[{ text, done }]`. Les entrées vides
 * sautent, les ids en double sont réattribués, et une liste vide vaut
 * `undefined` — le champ disparaît alors de l'événement.
 */
export function normalizeChecklist(input: unknown): ChecklistItem[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const seen = new Set<string>();
  const items: ChecklistItem[] = [];
  for (const raw of input.slice(0, CHECKLIST_MAX_ITEMS)) {
    const item = coerce(raw);
    if (!item) continue;
    if (seen.has(item.id)) item.id = newChecklistId();
    seen.add(item.id);
    items.push(item);
  }
  return items.length ? items : undefined;
}

/** Les entrées encore à faire (celles qui méritent de remonter dans un rappel). */
export function pendingChecklist(items?: ChecklistItem[]): string[] {
  return (items ?? []).filter((i) => !i.done).map((i) => i.text);
}

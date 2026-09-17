import { listEvents } from "./store";
import { listAccounts } from "./google/accounts";
import type { Attendee, EventItem } from "./types";

/**
 * L'ANNUAIRE — les gens avec qui l'utilisateur a déjà eu une réunion.
 *
 * Il n'est PAS stocké : il se déduit de l'agenda à chaque lecture, comme le
 * reste de la synchro Google se passe d'état serveur. Les sources sont les
 * invités des événements (invitations envoyées depuis l'agenda ET invitations
 * reçues, importées de Google) et l'organisateur d'un événement importé — qui
 * n'est pas toujours dans la liste des invités.
 *
 * Ce qu'on en fait : « ajoute une visio jeudi 14h avec Paul » → Josiane
 * retrouve l'email de Paul ici au lieu de le demander.
 */

export type Contact = {
  email: string;
  displayName?: string;
  /** Nombre d'événements partagés avec cette personne. */
  meetings: number;
  /** Début du dernier événement partagé (ISO local) — à venir compris. */
  lastMetAt: string;
  /** Titre de ce dernier événement. */
  lastTitle: string;
  /** Dernier événement DÉJÀ passé : on s'est effectivement vus. */
  lastPastAt?: string;
};

/** Minuscules, sans accents : « Gaël » et « gael » sont le même mot. */
export function normText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

/** La partie « prénom.nom » d'un email, en mots cherchables. */
function emailWords(email: string): string[] {
  return normText(email.split("@")[0]).split(/[._\-+0-9]+/).filter(Boolean);
}

/**
 * L'annuaire déduit d'une liste d'événements. `self` = les adresses de
 * l'utilisateur (ses comptes Google) : jamais un contact.
 */
export function buildContacts(events: EventItem[], self: Iterable<string> = []): Contact[] {
  const mine = new Set([...self].map((e) => e.toLowerCase()));
  const byEmail = new Map<string, Contact>();
  const nowIso = new Date().toISOString().slice(0, 19);

  const add = (person: Pick<Attendee, "email" | "displayName" | "self">, ev: EventItem) => {
    const email = (person.email || "").toLowerCase().trim();
    if (!email || person.self || mine.has(email)) return;
    const cur = byEmail.get(email);
    const name = person.displayName?.trim() || cur?.displayName;
    const past = ev.start <= nowIso ? ev.start : undefined;
    if (!cur) {
      byEmail.set(email, {
        email,
        ...(name ? { displayName: name } : {}),
        meetings: 1,
        lastMetAt: ev.start,
        lastTitle: ev.title,
        ...(past ? { lastPastAt: past } : {}),
      });
      return;
    }
    cur.meetings++;
    if (name && !cur.displayName) cur.displayName = name;
    if (ev.start > cur.lastMetAt) {
      cur.lastMetAt = ev.start;
      cur.lastTitle = ev.title;
    }
    if (past && past > (cur.lastPastAt || "")) cur.lastPastAt = past;
  };

  for (const ev of events) {
    for (const a of ev.attendees || []) add(a, ev);
    // L'organisateur d'une invitation reçue ne figure pas toujours parmi les
    // invités : c'est pourtant LA personne avec qui on a rendez-vous.
    const org = ev.google?.organizer;
    if (org?.email) add({ email: org.email, displayName: org.displayName, self: org.self }, ev);
  }

  return [...byEmail.values()].sort(
    (a, b) => b.lastMetAt.localeCompare(a.lastMetAt) || b.meetings - a.meetings
  );
}

/**
 * Les contacts qui correspondent à `query` (nom, prénom, fragment d'email),
 * les plus pertinents d'abord : email exact, puis début d'un mot du nom ou de
 * l'email, puis n'importe où. À pertinence égale, le plus récent gagne.
 * Requête vide = l'annuaire tel quel (déjà trié du plus récent au plus vieux).
 */
export function searchContacts(contacts: Contact[], query: string, limit = 10): Contact[] {
  const q = normText(query || "");
  if (!q) return contacts.slice(0, limit);

  const scored: { c: Contact; score: number }[] = [];
  for (const c of contacts) {
    const email = c.email.toLowerCase();
    const words = [...emailWords(c.email), ...normText(c.displayName || "").split(/\s+/)].filter(Boolean);
    let score = 0;
    if (email === q) score = 100;
    else if (words.includes(q)) score = 80;
    else if (words.some((w) => w.startsWith(q))) score = 60;
    else if (email.includes(q) || normText(c.displayName || "").includes(q)) score = 40;
    if (score > 0) scored.push({ c, score });
  }
  return scored
    .sort((x, y) => y.score - x.score || y.c.lastMetAt.localeCompare(x.c.lastMetAt))
    .slice(0, limit)
    .map((s) => s.c);
}

/** L'annuaire de l'agenda réel (événements + adresses des comptes connectés). */
export async function listContacts(): Promise<Contact[]> {
  const [events, accounts] = await Promise.all([listEvents(), listAccounts().catch(() => [])]);
  return buildContacts(
    events,
    accounts.map((a) => a.email)
  );
}

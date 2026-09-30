/**
 * Mode « calendrier professionnel » : règle PURE, sans dépendance serveur (la
 * modale d'événement s'en sert aussi côté client).
 */

export const OUT_OF_OFFICE_TITLE = "Out of office";

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** Le titre contient-il le mot-clé (sans égard à la casse ni aux accents) ? */
export function hasKeyword(title: string | undefined, keyword: string): boolean {
  return fold(title || "").includes(fold(keyword.trim()));
}

type WorkSettings = { workCalendar?: boolean; workKeyword?: string };

/**
 * Mot-clé du mode d'un compte, ou undefined s'il est inactif : case décochée,
 * ou mot vide (sinon TOUT deviendrait « Out of office »).
 */
export function workKeywordOf(account: WorkSettings): string | undefined {
  if (!account.workCalendar) return undefined;
  return account.workKeyword?.trim() || undefined;
}

/** Ce que la règle regarde d'un événement (un `EventItem` convient tel quel). */
export type WorkSubject = {
  title?: string;
  attendees?: { email?: string; self?: boolean }[];
  google?: { organizer?: { email?: string; self?: boolean } };
};

/**
 * L'événement « concerne » ce mot-clé : dans son titre, OU dans l'adresse d'un
 * participant ou de l'organisateur (une réunion « Félix, Pierre » avec des
 * @delosintelligence.fr). Jamais sur TA propre adresse (`self`) : elle serait
 * dans tous les événements de ce calendrier.
 */
export function matchesWork(ev: WorkSubject, keyword: string): boolean {
  if (hasKeyword(ev.title, keyword)) return true;
  const organizer = ev.google?.organizer;
  const emails = [
    ...(ev.attendees || []).filter((a) => !a.self).map((a) => a.email),
    ...(organizer && !organizer.self ? [organizer.email] : []),
  ];
  return emails.some((e) => Boolean(e) && hasKeyword(e, keyword));
}

/**
 * Ce calendrier montrerait-il cet événement en clair ? Faux quand le mode est
 * actif et que l'événement ne concerne pas le mot-clé (il y serait « Out of
 * office »). Événement inconnu → on ne préjuge de rien.
 */
export function showsEventInClear(account: WorkSettings, ev?: WorkSubject): boolean {
  const keyword = workKeywordOf(account);
  return !keyword || !ev || matchesWork(ev, keyword);
}

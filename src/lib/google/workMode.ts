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

/**
 * Ce calendrier montrerait-il cet événement en clair ? Faux quand le mode est
 * actif et que le titre n'a pas le mot-clé (il y serait « Out of office »).
 * Titre inconnu → on ne préjuge de rien.
 */
export function showsEventInClear(account: WorkSettings, title: string | undefined): boolean {
  const keyword = workKeywordOf(account);
  return !keyword || title === undefined || hasKeyword(title, keyword);
}

/**
 * Détection des liens écrits dans le texte libre d'un événement (notes, lieu).
 *
 * Un lien de réunion collé dans les notes — c'est ce que Google Calendar y met
 * pour une visio (« Visio : https://meet.google.com/… ») — ne se lit pas, il se
 * clique. On repère donc les URL, y compris celles écrites sans schéma
 * (`meet.google.com/abc-defg`), et on les rend prêtes à l'emploi.
 *
 * Aucune dépendance : une regex, un peu de ménage sur la ponctuation finale.
 */

export type DetectedLink = {
  /** URL absolue, prête pour un href. */
  url: string;
  /** Texte court à afficher (hôte + chemin abrégé). */
  label: string;
  /** Hôte seul, sans « www. ». */
  host: string;
  /** true pour une visio connue : le bouton devient « Rejoindre ». */
  meeting: boolean;
};

/** Hôtes de visioconférence reconnus (sous-domaines compris : `x.zoom.us`). */
const MEETING_HOSTS = [
  "meet.google.com",
  "zoom.us",
  "teams.microsoft.com",
  "teams.live.com",
  "whereby.com",
  "meet.jit.si",
  "webex.com",
  "chime.aws",
  "discord.gg",
  "livestorm.co",
  "bbb.ac-versailles.fr",
];

/**
 * Deux formes : une URL avec schéma (ou `www.`), et un lien de visio écrit
 * sans schéma — le seul cas où deviner reste sans risque.
 */
const LINK_RE = new RegExp(
  [
    "(?:https?://|www\\.)[^\\s<>\"'`\\u00a0]+",
    `(?:[a-z0-9-]+\\.)*(?:${MEETING_HOSTS.map((h) => h.replace(/\./g, "\\.")).join(
      "|"
    )})/[^\\s<>"'\`\\u00a0]+`,
  ].join("|"),
  "gi"
);

/** Ponctuation française ou anglaise qui suit un lien sans en faire partie. */
const TRAILING = ".,;:!?«»“”\"'…";

function countOf(text: string, char: string): number {
  let n = 0;
  for (const c of text) if (c === char) n++;
  return n;
}

/** Retire la ponctuation finale — sans casser un chemin qui contient ses parenthèses. */
function trimTrailing(raw: string): string {
  let out = raw;
  for (;;) {
    const last = out[out.length - 1];
    if (!last) break;
    if (TRAILING.includes(last)) {
      out = out.slice(0, -1);
      continue;
    }
    if (last === ")" || last === "]") {
      const open = last === ")" ? "(" : "[";
      if (countOf(out, last) > countOf(out, open)) {
        out = out.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return out;
}

function isMeetingHost(host: string): boolean {
  return MEETING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** « meet.google.com/abc-defg » — abrégé au milieu du chemin si besoin. */
function shortLabel(host: string, path: string, max = 40): string {
  const full = `${host}${path}`;
  if (full.length <= max) return full;
  const room = Math.max(0, max - host.length - 1);
  if (room < 6) return `${host}/…`;
  const head = Math.ceil(room / 2);
  const tail = room - head;
  return `${host}${path.slice(0, head)}…${tail ? path.slice(-tail) : ""}`;
}

/**
 * Extrait les liens des textes donnés, dans l'ordre d'apparition et sans
 * doublon. Les textes vides sont ignorés — appeler avec `(description, location)`
 * est le cas courant.
 */
export function extractLinks(...texts: (string | undefined | null)[]): DetectedLink[] {
  const seen = new Set<string>();
  const out: DetectedLink[] = [];

  for (const text of texts) {
    if (!text) continue;
    for (const match of text.match(LINK_RE) ?? []) {
      const cleaned = trimTrailing(match);
      if (!cleaned) continue;
      const url = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        continue;
      }
      // Un hôte sans point (« https://localhost ») n'est pas un lien partagé.
      if (!parsed.hostname.includes(".")) continue;
      const normalized = parsed.toString();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      const host = parsed.hostname.replace(/^www\./i, "");
      const path = `${parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "")}${
        parsed.search
      }`;
      out.push({
        url: normalized,
        label: shortLabel(host, path),
        host,
        meeting: isMeetingHost(host),
      });
    }
  }

  return out;
}

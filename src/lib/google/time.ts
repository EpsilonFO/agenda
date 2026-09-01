/**
 * Conversions de temps entre l'agenda (ISO local SANS fuseau, ex.
 * "2026-09-01T09:00:00", implicitement Europe/Paris) et Google Calendar
 * (RFC 3339 avec décalage, ex. "2026-09-01T09:00:00+02:00").
 *
 * Tout passe par Intl avec un fuseau EXPLICITE : le résultat ne dépend pas du
 * fuseau du process (le VPS peut être en UTC, les tests aussi).
 */

export const DEFAULT_TIME_ZONE = "Europe/Paris";

/** Fuseau de l'agenda (les événements locaux sont exprimés dans ce fuseau). */
export function syncTimeZone(): string {
  return process.env.GOOGLE_TIMEZONE || DEFAULT_TIME_ZONE;
}

type Parts = { y: number; m: number; d: number; h: number; mi: number; s: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Composantes « heure murale » d'un instant dans un fuseau. */
function partsIn(date: Date, tz: string): Parts {
  const out: Partial<Parts> = {};
  for (const p of formatter(tz).formatToParts(date)) {
    const v = Number(p.value);
    switch (p.type) {
      case "year":
        out.y = v;
        break;
      case "month":
        out.m = v;
        break;
      case "day":
        out.d = v;
        break;
      case "hour":
        out.h = v === 24 ? 0 : v;
        break;
      case "minute":
        out.mi = v;
        break;
      case "second":
        out.s = v;
        break;
    }
  }
  return out as Parts;
}

const pad = (n: number) => String(n).padStart(2, "0");

function formatParts(p: Parts): string {
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
}

/** Décalage (minutes, positif à l'est d'UTC) du fuseau `tz` à l'instant donné. */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const p = partsIn(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  // Les millisecondes de `date` ne sont pas dans les parts : on les retire.
  const base = date.getTime() - date.getMilliseconds();
  return Math.round((asUtc - base) / 60000);
}

/** Instant → ISO local sans fuseau ("2026-09-01T09:00:00") dans `tz`. */
export function instantToLocalIso(date: Date, tz: string): string {
  return formatParts(partsIn(date, tz));
}

const LOCAL_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;
const HAS_OFFSET_RE = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;

function parseLocalIso(iso: string): Parts | null {
  const m = LOCAL_ISO_RE.exec(iso.trim());
  if (!m) return null;
  return {
    y: Number(m[1]),
    m: Number(m[2]),
    d: Number(m[3]),
    h: Number(m[4]),
    mi: Number(m[5]),
    s: Number(m[6] || 0),
  };
}

/**
 * ISO local (sans fuseau) → instant, en interprétant l'heure murale dans `tz`.
 * Une chaîne qui porte déjà un décalage (ou Z) est prise telle quelle.
 * Aux changements d'heure : une heure inexistante (printemps) est décalée
 * d'une heure en avant, une heure ambiguë (automne) prend le premier passage.
 */
export function localIsoToInstant(iso: string, tz: string): Date {
  if (HAS_OFFSET_RE.test(iso)) return new Date(iso);
  const p = parseLocalIso(iso);
  if (!p) return new Date(iso);
  const guess = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  const off1 = tzOffsetMinutes(new Date(guess), tz);
  let instant = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(new Date(instant), tz);
  if (off2 !== off1) instant = guess - off2 * 60000;
  return new Date(instant);
}

/** ISO local → RFC 3339 avec décalage explicite ("2026-09-01T09:00:00+02:00"). */
export function localIsoToRfc3339(iso: string, tz: string): string {
  const instant = localIsoToInstant(iso, tz);
  const off = tzOffsetMinutes(instant, tz);
  const wall = instantToLocalIso(instant, tz);
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return `${wall}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** `start.dateTime` Google (RFC 3339, n'importe quel décalage) → ISO local dans `tz`. */
export function googleDateTimeToLocalIso(dateTime: string, tz: string): string {
  return instantToLocalIso(new Date(dateTime), tz);
}

/** Vrai si [start, end) recoupe la fenêtre [wStart, wEnd) — même critère que Google. */
export function overlapsWindow(
  start: Date,
  end: Date,
  wStart: Date,
  wEnd: Date
): boolean {
  return end.getTime() > wStart.getTime() && start.getTime() < wEnd.getTime();
}

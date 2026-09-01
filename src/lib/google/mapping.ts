import crypto from "crypto";
import type { Attendee, AttendeeResponse, EventItem, GoogleOrigin } from "../types";
import type { GoogleAccount } from "./accounts";
import type { GoogleEvent, GoogleEventBody } from "./types";
import { googleDateTimeToLocalIso, localIsoToRfc3339 } from "./time";

/**
 * Correspondance événement local ⇄ événement Google. Fonctions PURES : la
 * synchro (sync.ts) les orchestre, les tests les vérifient sans réseau.
 *
 * Marqueurs posés sur nos copies côté Google (extendedProperties.private) :
 *   - agendaId   : id de l'événement local dont c'est la copie ;
 *   - agendaHash : empreinte du contenu poussé (détecte un changement local
 *                  sans garder d'état côté serveur).
 * Un événement Google SANS agendaId est « étranger » (invitation reçue,
 * créé dans Google) → candidat à l'import.
 */

export const EXT_ID = "agendaId";
export const EXT_HASH = "agendaHash";
export const DEFAULT_BUSY_TITLE = "Occupé";
export const UNTITLED = "(Sans titre)";

export function ownLocalId(g: GoogleEvent): string | undefined {
  return g.extendedProperties?.private?.[EXT_ID] || undefined;
}

export function ownHash(g: GoogleEvent): string | undefined {
  return g.extendedProperties?.private?.[EXT_HASH] || undefined;
}

/** Vrai si la copie Google a des invités autres que le propriétaire (→ notifier). */
export function hasGuests(g: GoogleEvent): boolean {
  return (g.attendees || []).some((a) => !a.self && !a.resource);
}

/* ------------------------------ Local → Google ------------------------------ */

export type ProjectOpts = {
  detail: "full" | "busy";
  busyTitle?: string;
  /** Inclure les invités (uniquement sur le compte qui porte l'invitation). */
  withAttendees: boolean;
  tz: string;
};

/** Empreinte du contenu pertinent d'une copie (ordre des invités indifférent). */
export function hashBody(body: GoogleEventBody): string {
  const key = JSON.stringify({
    s: body.summary,
    d: body.description ?? "",
    l: body.location ?? "",
    st: body.start.dateTime ?? body.start.date ?? "",
    en: body.end.dateTime ?? body.end.date ?? "",
    v: body.visibility ?? "",
    a: (body.attendees ?? []).map((a) => a.email.toLowerCase()).sort(),
  });
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 20);
}

/** Projette un événement local en corps Google (copie « miroir »). */
export function projectLocalEvent(ev: EventItem, opts: ProjectOpts): GoogleEventBody {
  const attendees = opts.withAttendees
    ? (ev.attendees ?? [])
        .filter((a) => a.email && !a.self)
        .map((a) => ({
          email: a.email.toLowerCase(),
          ...(a.optional ? { optional: true } : {}),
        }))
    : [];
  // Une invitation porte toujours le vrai contenu, même en mode « occupé ».
  const full = opts.detail === "full" || attendees.length > 0;

  const body: GoogleEventBody = {
    summary: full ? ev.title?.trim() || UNTITLED : opts.busyTitle?.trim() || DEFAULT_BUSY_TITLE,
    start: { dateTime: localIsoToRfc3339(ev.start, opts.tz), timeZone: opts.tz },
    end: { dateTime: localIsoToRfc3339(ev.end, opts.tz), timeZone: opts.tz },
    transparency: "opaque",
    // Les rappels sont gérés par l'agenda (push) : pas de doublon Google.
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: { private: { [EXT_ID]: ev.id, [EXT_HASH]: "" } },
  };
  if (full) {
    if (ev.description?.trim()) body.description = ev.description.trim();
    if (ev.location?.trim()) body.location = ev.location.trim();
  } else {
    body.visibility = "private";
  }
  if (attendees.length) body.attendees = attendees;
  body.extendedProperties.private[EXT_HASH] = hashBody(body);
  return body;
}

/**
 * Pour un PATCH : reprend le statut de réponse déjà connu côté Google pour
 * chaque invité (sinon Google pourrait les remettre « en attente »).
 */
export function mergeAttendeeStatuses(body: GoogleEventBody, remote: GoogleEvent): GoogleEventBody {
  if (!body.attendees?.length) return body;
  const byEmail = new Map(
    (remote.attendees || [])
      .filter((a) => a.email)
      .map((a) => [a.email!.toLowerCase(), a] as const)
  );
  return {
    ...body,
    attendees: body.attendees.map((a) => {
      const r = byEmail.get(a.email.toLowerCase());
      return r?.responseStatus ? { ...a, responseStatus: r.responseStatus } : a;
    }),
  };
}

/* ------------------------------ Google → Local ------------------------------ */

export type SkipReason = "own" | "cancelled" | "all-day" | "declined" | "type";

/** Pourquoi un événement Google n'est PAS importé (null = à importer). */
export function importSkipReason(g: GoogleEvent): SkipReason | null {
  if (ownLocalId(g)) return "own";
  if (g.status === "cancelled") return "cancelled";
  if (!g.start?.dateTime || !g.end?.dateTime) return "all-day";
  const me = (g.attendees || []).find((a) => a.self);
  if (me?.responseStatus === "declined") return "declined";
  if (g.eventType === "workingLocation" || g.eventType === "birthday") return "type";
  return null;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** Les descriptions Google sont souvent en HTML : on garde le texte. */
export function cleanDescription(html?: string): string | undefined {
  if (!html) return undefined;
  let text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length > 2000) text = text.slice(0, 1997) + "…";
  return text || undefined;
}

function toAttendee(a: NonNullable<GoogleEvent["attendees"]>[number]): Attendee | null {
  if (!a.email || a.resource) return null;
  const out: Attendee = { email: a.email.toLowerCase() };
  if (a.displayName) out.displayName = a.displayName;
  if (a.responseStatus) out.responseStatus = a.responseStatus as AttendeeResponse;
  if (a.self) out.self = true;
  if (a.organizer) out.organizer = true;
  if (a.optional) out.optional = true;
  return out;
}

export type ImportedFields = Pick<
  EventItem,
  "title" | "start" | "end" | "description" | "location" | "attendees"
> & { google: GoogleOrigin };

/**
 * Champs locaux d'un événement Google étranger. Suppose `importSkipReason`
 * nul (dateTime présents).
 */
export function importGoogleEvent(
  g: GoogleEvent,
  account: Pick<GoogleAccount, "id" | "calendarId">,
  tz: string,
  nowIso: string
): ImportedFields {
  const attendees = (g.attendees || [])
    .map(toAttendee)
    .filter((a): a is Attendee => a !== null);
  const me = attendees.find((a) => a.self);
  const organizerSelf = Boolean(g.organizer?.self);

  let description = cleanDescription(g.description);
  if (g.hangoutLink && !(description || "").includes(g.hangoutLink)) {
    description = [description, `Visio : ${g.hangoutLink}`].filter(Boolean).join("\n\n");
  }

  const google: GoogleOrigin = {
    accountId: account.id,
    calendarId: account.calendarId,
    eventId: g.id,
    syncedAt: nowIso,
  };
  if (g.etag) google.etag = g.etag;
  if (g.updated) google.updated = g.updated;
  if (g.htmlLink) google.htmlLink = g.htmlLink;
  if (g.status) google.status = g.status;
  if (g.organizer) {
    google.organizer = {
      ...(g.organizer.email ? { email: g.organizer.email.toLowerCase() } : {}),
      ...(g.organizer.displayName ? { displayName: g.organizer.displayName } : {}),
      ...(g.organizer.self ? { self: true } : {}),
    };
  }
  // Réponse attendue uniquement si l'utilisateur est invité (pas organisateur).
  if (me && !organizerSelf && !me.organizer) google.myResponse = me.responseStatus || "needsAction";
  if (g.recurringEventId) google.recurringEventId = g.recurringEventId;
  if (g.iCalUID) google.iCalUID = g.iCalUID;

  const out: ImportedFields = {
    title: g.summary?.trim() || UNTITLED,
    start: googleDateTimeToLocalIso(g.start!.dateTime!, tz),
    end: googleDateTimeToLocalIso(g.end!.dateTime!, tz),
    google,
  };
  if (description) out.description = description;
  if (g.location?.trim()) out.location = g.location.trim();
  if (attendees.length) out.attendees = attendees;
  return out;
}

/**
 * Modifications LOCALES d'un événement importé à renvoyer à Google : seuls
 * les champs qui diffèrent de la version Google actuelle (déjà importée).
 */
export function diffOriginPatch(
  local: EventItem,
  remoteImported: ImportedFields,
  tz: string
): Partial<GoogleEventBody> {
  const patch: Partial<GoogleEventBody> = {};
  if ((local.title || "").trim() !== remoteImported.title) {
    patch.summary = local.title?.trim() || UNTITLED;
  }
  if (local.start !== remoteImported.start) {
    patch.start = { dateTime: localIsoToRfc3339(local.start, tz), timeZone: tz };
  }
  if (local.end !== remoteImported.end) {
    patch.end = { dateTime: localIsoToRfc3339(local.end, tz), timeZone: tz };
  }
  const ld = (local.description || "").trim();
  if (ld !== (remoteImported.description || "").trim()) patch.description = ld;
  const ll = (local.location || "").trim();
  if (ll !== (remoteImported.location || "").trim()) patch.location = ll;
  return patch;
}

/**
 * Retour d'une invitation envoyée depuis l'agenda : statuts des invités lus
 * sur notre copie Google, invités ajoutés par les invités eux-mêmes inclus.
 * Renvoie null si rien ne change.
 */
export function inviteFeedback(
  local: EventItem,
  copy: GoogleEvent,
  nowIso: string
): Pick<EventItem, "attendees" | "invite"> | null {
  const remote = (copy.attendees || [])
    .map(toAttendee)
    .filter((a): a is Attendee => a !== null && !a.self && !a.organizer);
  const byEmail = new Map(remote.map((a) => [a.email, a] as const));

  const merged: Attendee[] = (local.attendees || []).map((a) => {
    const r = byEmail.get(a.email.toLowerCase());
    if (!r) return a;
    const next: Attendee = { ...a, email: a.email.toLowerCase() };
    if (r.responseStatus) next.responseStatus = r.responseStatus;
    if (r.displayName && !next.displayName) next.displayName = r.displayName;
    return next;
  });
  const known = new Set(merged.map((a) => a.email.toLowerCase()));
  for (const r of remote) if (!known.has(r.email)) merged.push(r);

  const invite = {
    ...(local.invite || { accountId: "" }),
    eventId: copy.id,
    ...(copy.htmlLink ? { htmlLink: copy.htmlLink } : {}),
    sentAt: local.invite?.sentAt || nowIso,
  };

  const same =
    JSON.stringify(merged) === JSON.stringify(local.attendees || []) &&
    local.invite?.eventId === invite.eventId &&
    local.invite?.htmlLink === invite.htmlLink &&
    Boolean(local.invite?.sentAt);
  if (same) return null;
  return { attendees: merged, invite };
}

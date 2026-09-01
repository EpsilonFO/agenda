/**
 * Sous-ensemble de l'API Google Calendar v3 utilisé par la synchro.
 * https://developers.google.com/calendar/api/v3/reference/events
 */

export type GoogleDateTime = {
  /** RFC 3339, événements à heure fixe. */
  dateTime?: string;
  /** YYYY-MM-DD, événements « journée entière ». */
  date?: string;
  timeZone?: string;
};

export type GoogleAttendee = {
  email?: string;
  displayName?: string;
  responseStatus?: "needsAction" | "accepted" | "declined" | "tentative";
  self?: boolean;
  organizer?: boolean;
  optional?: boolean;
  /** Salle / ressource — jamais un humain. */
  resource?: boolean;
  comment?: string;
};

export type GooglePerson = { email?: string; displayName?: string; self?: boolean };

export type GoogleEvent = {
  id: string;
  etag?: string;
  status?: "confirmed" | "tentative" | "cancelled";
  htmlLink?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleDateTime;
  end?: GoogleDateTime;
  /** ISO UTC de la dernière modification côté Google. */
  updated?: string;
  created?: string;
  organizer?: GooglePerson;
  creator?: GooglePerson;
  attendees?: GoogleAttendee[];
  recurringEventId?: string;
  iCalUID?: string;
  transparency?: "opaque" | "transparent";
  visibility?: "default" | "public" | "private" | "confidential";
  eventType?: string;
  hangoutLink?: string;
  extendedProperties?: {
    private?: Record<string, string>;
    shared?: Record<string, string>;
  };
};

/** Corps envoyé à insert/patch. */
export type GoogleEventBody = {
  summary: string;
  description?: string;
  location?: string;
  start: GoogleDateTime;
  end: GoogleDateTime;
  transparency?: "opaque" | "transparent";
  visibility?: "default" | "public" | "private" | "confidential";
  attendees?: { email: string; optional?: boolean; responseStatus?: GoogleAttendee["responseStatus"] }[];
  reminders?: { useDefault: boolean; overrides: { method: string; minutes: number }[] };
  extendedProperties: { private: Record<string, string> };
};

export type GoogleCalendarListEntry = {
  id: string;
  summary?: string;
  summaryOverride?: string;
  primary?: boolean;
  accessRole?: "freeBusyReader" | "reader" | "writer" | "owner";
  backgroundColor?: string;
  selected?: boolean;
};

/** Statistiques d'un passage de synchro pour UN compte. */
export type AccountSyncStats = {
  pushedCreated: number;
  pushedUpdated: number;
  pushedDeleted: number;
  pulledCreated: number;
  pulledUpdated: number;
  pulledDeleted: number;
  tombstones: number;
  /** Opérations Google qui ont échoué (sans faire tomber le passage). */
  failed: number;
  warnings: string[];
};

export type AccountSyncResult = {
  accountId: string;
  email: string;
  ok: boolean;
  error?: string;
  stats: AccountSyncStats;
  durationMs: number;
};

export type SyncReport = {
  ranAt: string;
  /** Raison d'un passage à vide (non configuré, aucun compte…). */
  skipped?: string;
  accounts: AccountSyncResult[];
};

export function emptyStats(): AccountSyncStats {
  return {
    pushedCreated: 0,
    pushedUpdated: 0,
    pushedDeleted: 0,
    pulledCreated: 0,
    pulledUpdated: 0,
    pulledDeleted: 0,
    tombstones: 0,
    failed: 0,
    warnings: [],
  };
}

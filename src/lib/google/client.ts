import { getAccount, updateAccount, type GoogleAccount } from "./accounts";
import { GoogleAuthError, refreshAccessToken } from "./oauth";
import type { GoogleCalendarListEntry, GoogleEvent, GoogleEventBody } from "./types";

/**
 * Client minimal de l'API Google Calendar v3 (fetch pur). Gère le
 * rafraîchissement de l'access token, une relance sur 401, et un court
 * backoff sur 429 / 5xx / rateLimitExceeded.
 */

const API = "https://www.googleapis.com/calendar/v3";

export class GoogleApiError extends Error {
  status: number;
  reason?: string;
  constructor(status: number, message: string, reason?: string) {
    super(message);
    this.name = "GoogleApiError";
    this.status = status;
    this.reason = reason;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Access token valide pour ce compte (rafraîchi et persisté si besoin). */
export async function accessTokenFor(account: GoogleAccount, force = false): Promise<string> {
  const exp = account.accessTokenExpiresAt ? Date.parse(account.accessTokenExpiresAt) : 0;
  const fresh = account.accessToken && exp - Date.now() > 60_000;
  if (fresh && !force) return account.accessToken as string;

  try {
    const tok = await refreshAccessToken(account.refreshToken);
    const expiresAt = new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString();
    account.accessToken = tok.access_token;
    account.accessTokenExpiresAt = expiresAt;
    await updateAccount(account.id, {
      accessToken: tok.access_token,
      accessTokenExpiresAt: expiresAt,
      // Le refresh token peut être renouvelé par Google (rare) : on le garde.
      refreshToken: tok.refresh_token || account.refreshToken,
      status: "ok",
    });
    return tok.access_token;
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      await updateAccount(account.id, { status: "reauth", lastError: err.message });
    }
    throw err;
  }
}

type FetchOpts = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, string | undefined>;
  body?: unknown;
};

function buildUrl(path: string, query?: Record<string, string | undefined>): string {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }
  return url.toString();
}

/**
 * Appel authentifié. Renvoie le JSON (ou null si 204). Lève GoogleApiError
 * sur toute réponse non-2xx après les relances.
 */
export async function gfetch<T = unknown>(
  account: GoogleAccount,
  path: string,
  opts: FetchOpts = {}
): Promise<T | null> {
  let token = await accessTokenFor(account);
  let retried401 = false;
  let attempt = 0;

  for (;;) {
    const res = await fetch(buildUrl(path, opts.query), {
      method: opts.method || "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    if (res.status === 204) return null;
    if (res.ok) {
      const text = await res.text();
      return text ? (JSON.parse(text) as T) : null;
    }

    const data = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; errors?: { reason?: string }[] };
    };
    const reason = data.error?.errors?.[0]?.reason;
    const message = data.error?.message || res.statusText || `HTTP ${res.status}`;

    if (res.status === 401 && !retried401) {
      retried401 = true;
      // Le compte a peut-être été rechargé entre-temps : on repart du disque.
      const current = (await getAccount(account.id)) || account;
      token = await accessTokenFor(current, true);
      continue;
    }
    const rateLimited =
      res.status === 429 ||
      (res.status === 403 &&
        (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded"));
    if ((rateLimited || res.status >= 500) && attempt < 2) {
      attempt++;
      await sleep(1000 * attempt);
      continue;
    }
    throw new GoogleApiError(res.status, `${message}${reason ? ` (${reason})` : ""}`, reason);
  }
}

/* ------------------------------ Calendriers ------------------------------ */

export async function listCalendars(account: GoogleAccount): Promise<GoogleCalendarListEntry[]> {
  const out: GoogleCalendarListEntry[] = [];
  let pageToken: string | undefined;
  do {
    const page = await gfetch<{ items?: GoogleCalendarListEntry[]; nextPageToken?: string }>(
      account,
      "/users/me/calendarList",
      { query: { minAccessRole: "writer", pageToken } }
    );
    out.push(...(page?.items || []));
    pageToken = page?.nextPageToken;
  } while (pageToken);
  return out;
}

/* ------------------------------ Événements ------------------------------- */

function calPath(calendarId: string): string {
  return `/calendars/${encodeURIComponent(calendarId)}/events`;
}

/**
 * Tous les événements (instances de récurrence développées, annulés inclus)
 * qui recoupent [timeMin, timeMax). Paginé.
 */
export async function listEventsInWindow(
  account: GoogleAccount,
  calendarId: string,
  timeMin: Date,
  timeMax: Date
): Promise<GoogleEvent[]> {
  const out: GoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
    const page = await gfetch<{ items?: GoogleEvent[]; nextPageToken?: string }>(
      account,
      calPath(calendarId),
      {
        query: {
          singleEvents: "true",
          showDeleted: "true",
          maxResults: "2500",
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          pageToken,
        },
      }
    );
    out.push(...(page?.items || []));
    pageToken = page?.nextPageToken;
  } while (pageToken);
  return out;
}

export async function getEvent(
  account: GoogleAccount,
  calendarId: string,
  eventId: string
): Promise<GoogleEvent | null> {
  try {
    return await gfetch<GoogleEvent>(
      account,
      `${calPath(calendarId)}/${encodeURIComponent(eventId)}`
    );
  } catch (err) {
    if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) return null;
    throw err;
  }
}

export async function insertEvent(
  account: GoogleAccount,
  calendarId: string,
  body: GoogleEventBody,
  sendUpdates: boolean
): Promise<GoogleEvent> {
  const created = await gfetch<GoogleEvent>(account, calPath(calendarId), {
    method: "POST",
    query: { sendUpdates: sendUpdates ? "all" : "none" },
    body,
  });
  if (!created) throw new GoogleApiError(500, "insert sans réponse");
  return created;
}

export async function patchEvent(
  account: GoogleAccount,
  calendarId: string,
  eventId: string,
  body: Partial<GoogleEventBody> | Pick<GoogleEvent, "attendees">,
  sendUpdates: boolean
): Promise<GoogleEvent> {
  const updated = await gfetch<GoogleEvent>(
    account,
    `${calPath(calendarId)}/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      query: { sendUpdates: sendUpdates ? "all" : "none" },
      body,
    }
  );
  if (!updated) throw new GoogleApiError(500, "patch sans réponse");
  return updated;
}

/** Suppression idempotente : un événement déjà parti (404/410) compte comme supprimé. */
export async function deleteEvent(
  account: GoogleAccount,
  calendarId: string,
  eventId: string,
  sendUpdates: boolean
): Promise<void> {
  try {
    await gfetch(account, `${calPath(calendarId)}/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
      query: { sendUpdates: sendUpdates ? "all" : "none" },
    });
  } catch (err) {
    if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) return;
    throw err;
  }
}

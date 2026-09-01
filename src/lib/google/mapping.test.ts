import { describe, expect, it } from "vitest";
import type { EventItem } from "../types";
import type { GoogleEvent } from "./types";
import {
  EXT_HASH,
  EXT_ID,
  cleanDescription,
  diffOriginPatch,
  hashBody,
  importGoogleEvent,
  importSkipReason,
  inviteFeedback,
  mergeAttendeeStatuses,
  projectLocalEvent,
} from "./mapping";

const TZ = "Europe/Paris";
const NOW = "2026-09-01T10:00:00.000Z";

function local(over: Partial<EventItem> = {}): EventItem {
  return {
    id: "loc-1",
    title: "Point équipe",
    start: "2026-09-02T09:00:00",
    end: "2026-09-02T10:00:00",
    description: "Ordre du jour",
    location: "Delos",
    category: "delos",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function remote(over: Partial<GoogleEvent> = {}): GoogleEvent {
  return {
    id: "g-1",
    status: "confirmed",
    summary: "Réunion produit",
    start: { dateTime: "2026-09-02T07:00:00Z" },
    end: { dateTime: "2026-09-02T08:00:00Z" },
    updated: "2026-08-30T12:00:00.000Z",
    htmlLink: "https://calendar.google.com/event?eid=abc",
    organizer: { email: "Boss@Delos.fr", displayName: "Boss" },
    attendees: [
      { email: "boss@delos.fr", organizer: true, responseStatus: "accepted" },
      { email: "felix@delos.fr", self: true, responseStatus: "needsAction" },
      { email: "salle-a@resource.calendar.google.com", resource: true, responseStatus: "accepted" },
    ],
    ...over,
  };
}

describe("projectLocalEvent — agenda → Google", () => {
  it("mode détaillé : contenu réel, marqueurs, rappels coupés, opaque", () => {
    const body = projectLocalEvent(local(), { detail: "full", withAttendees: false, tz: TZ });
    expect(body.summary).toBe("Point équipe");
    expect(body.description).toBe("Ordre du jour");
    expect(body.location).toBe("Delos");
    expect(body.start).toEqual({ dateTime: "2026-09-02T09:00:00+02:00", timeZone: TZ });
    expect(body.end).toEqual({ dateTime: "2026-09-02T10:00:00+02:00", timeZone: TZ });
    expect(body.transparency).toBe("opaque");
    expect(body.visibility).toBeUndefined();
    expect(body.reminders).toEqual({ useDefault: false, overrides: [] });
    expect(body.extendedProperties.private[EXT_ID]).toBe("loc-1");
    expect(body.extendedProperties.private[EXT_HASH]).toBe(hashBody(body));
    expect(body.attendees).toBeUndefined();
  });

  it("mode occupé : titre générique, privé, sans détails", () => {
    const body = projectLocalEvent(local(), {
      detail: "busy",
      busyTitle: "Pris",
      withAttendees: false,
      tz: TZ,
    });
    expect(body.summary).toBe("Pris");
    expect(body.visibility).toBe("private");
    expect(body.description).toBeUndefined();
    expect(body.location).toBeUndefined();
  });

  it("une invitation force le contenu réel même en mode occupé, sans l'utilisateur lui-même", () => {
    const ev = local({
      attendees: [{ email: "Alice@x.fr" }, { email: "me@x.fr", self: true }, { email: "bob@x.fr", optional: true }],
    });
    const body = projectLocalEvent(ev, { detail: "busy", withAttendees: true, tz: TZ });
    expect(body.summary).toBe("Point équipe");
    expect(body.visibility).toBeUndefined();
    expect(body.attendees).toEqual([{ email: "alice@x.fr" }, { email: "bob@x.fr", optional: true }]);
  });

  it("le hash ignore l'ordre des invités et ne bouge pas pour un contenu identique", () => {
    const a = projectLocalEvent(local({ attendees: [{ email: "a@x.fr" }, { email: "b@x.fr" }] }), {
      detail: "full",
      withAttendees: true,
      tz: TZ,
    });
    const b = projectLocalEvent(local({ attendees: [{ email: "b@x.fr" }, { email: "a@x.fr" }] }), {
      detail: "full",
      withAttendees: true,
      tz: TZ,
    });
    expect(hashBody(a)).toBe(hashBody(b));
    const c = projectLocalEvent(local({ title: "Autre" }), { detail: "full", withAttendees: false, tz: TZ });
    expect(hashBody(c)).not.toBe(hashBody(a));
  });

  it("mergeAttendeeStatuses reprend les réponses déjà connues côté Google", () => {
    const body = projectLocalEvent(local({ attendees: [{ email: "a@x.fr" }, { email: "b@x.fr" }] }), {
      detail: "full",
      withAttendees: true,
      tz: TZ,
    });
    const merged = mergeAttendeeStatuses(body, remote({ attendees: [{ email: "A@x.fr", responseStatus: "accepted" }] }));
    expect(merged.attendees).toEqual([{ email: "a@x.fr", responseStatus: "accepted" }, { email: "b@x.fr" }]);
  });
});

describe("importSkipReason", () => {
  it("nos copies, annulés, journée entière, refusés, types spéciaux", () => {
    expect(importSkipReason(remote({ extendedProperties: { private: { [EXT_ID]: "x" } } }))).toBe("own");
    expect(importSkipReason(remote({ status: "cancelled" }))).toBe("cancelled");
    expect(importSkipReason(remote({ start: { date: "2026-09-02" }, end: { date: "2026-09-03" } }))).toBe("all-day");
    expect(
      importSkipReason(remote({ attendees: [{ email: "felix@delos.fr", self: true, responseStatus: "declined" }] }))
    ).toBe("declined");
    expect(importSkipReason(remote({ eventType: "workingLocation" }))).toBe("type");
    expect(importSkipReason(remote())).toBeNull();
  });
});

describe("importGoogleEvent — Google → agenda", () => {
  it("convertit heures, participants, organisateur, réponse attendue", () => {
    const f = importGoogleEvent(remote(), { id: "acc", calendarId: "primary" }, TZ, NOW);
    expect(f.title).toBe("Réunion produit");
    expect(f.start).toBe("2026-09-02T09:00:00");
    expect(f.end).toBe("2026-09-02T10:00:00");
    expect(f.attendees).toEqual([
      { email: "boss@delos.fr", organizer: true, responseStatus: "accepted" },
      { email: "felix@delos.fr", self: true, responseStatus: "needsAction" },
    ]);
    expect(f.google).toMatchObject({
      accountId: "acc",
      calendarId: "primary",
      eventId: "g-1",
      updated: "2026-08-30T12:00:00.000Z",
      syncedAt: NOW,
      htmlLink: "https://calendar.google.com/event?eid=abc",
      organizer: { email: "boss@delos.fr", displayName: "Boss" },
      myResponse: "needsAction",
    });
  });

  it("organisateur = l'utilisateur → pas de réponse attendue", () => {
    const f = importGoogleEvent(
      remote({
        organizer: { email: "felix@delos.fr", self: true },
        attendees: [{ email: "felix@delos.fr", self: true, organizer: true, responseStatus: "accepted" }],
      }),
      { id: "acc", calendarId: "primary" },
      TZ,
      NOW
    );
    expect(f.google.myResponse).toBeUndefined();
  });

  it("description HTML nettoyée + lien Meet ajouté, titre vide remplacé", () => {
    const f = importGoogleEvent(
      remote({
        summary: "  ",
        description: "<p>Bonjour<br>Ordre du jour&nbsp;: <b>budget</b> &amp; roadmap</p>",
        hangoutLink: "https://meet.google.com/abc-defg-hij",
      }),
      { id: "acc", calendarId: "primary" },
      TZ,
      NOW
    );
    expect(f.title).toBe("(Sans titre)");
    expect(f.description).toBe("Bonjour\nOrdre du jour : budget & roadmap\n\nVisio : https://meet.google.com/abc-defg-hij");
  });

  it("cleanDescription : vide → undefined, texte brut inchangé", () => {
    expect(cleanDescription("")).toBeUndefined();
    expect(cleanDescription("  ")).toBeUndefined();
    expect(cleanDescription("Simple")).toBe("Simple");
  });
});

describe("diffOriginPatch — modifications locales d'un importé", () => {
  it("ne renvoie que les champs qui diffèrent", () => {
    const imported = importGoogleEvent(remote(), { id: "acc", calendarId: "primary" }, TZ, NOW);
    // Même contenu que l'import (description/lieu absents côté Google), heure déplacée.
    const base: Partial<EventItem> = { ...imported, description: undefined, location: undefined, source: "google" };
    const ev = local({ ...base, id: "loc-2", start: "2026-09-02T14:00:00", end: "2026-09-02T15:00:00" });
    const patch = diffOriginPatch(ev, imported, TZ);
    expect(patch).toEqual({
      start: { dateTime: "2026-09-02T14:00:00+02:00", timeZone: TZ },
      end: { dateTime: "2026-09-02T15:00:00+02:00", timeZone: TZ },
    });
    expect(diffOriginPatch(local({ ...base, id: "loc-3" }), imported, TZ)).toEqual({});
    // Un lieu ajouté localement part aussi.
    expect(diffOriginPatch(local({ ...base, id: "loc-4", location: "Salle B" }), imported, TZ)).toEqual({
      location: "Salle B",
    });
  });
});

describe("inviteFeedback — retour des réponses sur une invitation envoyée", () => {
  const ev = local({
    attendees: [{ email: "alice@x.fr" }, { email: "bob@x.fr" }],
    invite: { accountId: "acc" },
  });
  const copy = remote({
    id: "copy-1",
    htmlLink: "https://calendar.google.com/event?eid=copy",
    attendees: [
      { email: "me@x.fr", self: true, organizer: true, responseStatus: "accepted" },
      { email: "alice@x.fr", responseStatus: "accepted", displayName: "Alice" },
      { email: "bob@x.fr", responseStatus: "declined" },
      { email: "carol@x.fr", responseStatus: "needsAction" },
    ],
  });

  it("fusionne statuts, ajoute les invités ajoutés côté Google, renseigne le lien", () => {
    const fb = inviteFeedback(ev, copy, NOW);
    expect(fb?.attendees).toEqual([
      { email: "alice@x.fr", responseStatus: "accepted", displayName: "Alice" },
      { email: "bob@x.fr", responseStatus: "declined" },
      { email: "carol@x.fr", responseStatus: "needsAction" },
    ]);
    expect(fb?.invite).toEqual({
      accountId: "acc",
      eventId: "copy-1",
      htmlLink: "https://calendar.google.com/event?eid=copy",
      sentAt: NOW,
    });
  });

  it("null quand rien ne change", () => {
    const fb = inviteFeedback(ev, copy, NOW)!;
    const synced = local({ ...ev, attendees: fb.attendees, invite: fb.invite });
    expect(inviteFeedback(synced, copy, "2026-09-01T11:00:00.000Z")).toBeNull();
  });
});

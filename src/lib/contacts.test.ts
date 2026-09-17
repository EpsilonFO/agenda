import { describe, expect, it } from "vitest";
import { buildContacts, searchContacts } from "./contacts";
import type { EventItem } from "./types";

/** Un événement de l'agenda, réduit à ce que l'annuaire regarde. */
function ev(over: Partial<EventItem> = {}): EventItem {
  return {
    id: "e1",
    title: "Point produit",
    start: "2026-03-10T14:00:00",
    end: "2026-03-10T15:00:00",
    createdAt: "2026-03-01T10:00:00.000Z",
    updatedAt: "2026-03-01T10:00:00.000Z",
    ...over,
  };
}

const MOI = ["felixollivier@delosintelligence.fr"];

describe("buildContacts — l'annuaire déduit de l'agenda", () => {
  it("retient les invités, jamais l'utilisateur lui-même", () => {
    const contacts = buildContacts(
      [
        ev({
          attendees: [
            { email: "Paul@Client.fr", displayName: "Paul Martin" },
            { email: "felixollivier@delosintelligence.fr", self: true },
          ],
        }),
      ],
      MOI
    );
    expect(contacts).toEqual([
      {
        email: "paul@client.fr",
        displayName: "Paul Martin",
        meetings: 1,
        lastMetAt: "2026-03-10T14:00:00",
        lastTitle: "Point produit",
        lastPastAt: "2026-03-10T14:00:00",
      },
    ]);
  });

  it("écarte aussi les adresses des comptes connectés, même sans le drapeau self", () => {
    const contacts = buildContacts(
      [ev({ attendees: [{ email: "felixollivier@delosintelligence.fr" }] })],
      MOI
    );
    expect(contacts).toEqual([]);
  });

  it("compte les réunions et garde la plus récente (à venir comprise)", () => {
    const contacts = buildContacts(
      [
        ev({ id: "a", attendees: [{ email: "paul@client.fr" }] }),
        ev({
          id: "b",
          title: "Kickoff",
          start: "2099-01-05T09:00:00",
          end: "2099-01-05T10:00:00",
          attendees: [{ email: "paul@client.fr" }],
        }),
      ],
      MOI
    );
    expect(contacts[0].meetings).toBe(2);
    expect(contacts[0].lastMetAt).toBe("2099-01-05T09:00:00");
    expect(contacts[0].lastTitle).toBe("Kickoff");
    // …mais « déjà vus » reste la dernière réunion PASSÉE.
    expect(contacts[0].lastPastAt).toBe("2026-03-10T14:00:00");
  });

  it("l'organisateur d'une invitation reçue est un contact, même absent des invités", () => {
    const contacts = buildContacts(
      [
        ev({
          source: "google",
          google: {
            accountId: "acc",
            calendarId: "primary",
            eventId: "g1",
            syncedAt: "2026-03-01T10:00:00.000Z",
            organizer: { email: "boss@delos.fr", displayName: "La Boss" },
          },
        }),
      ],
      MOI
    );
    expect(contacts.map((c) => c.email)).toEqual(["boss@delos.fr"]);
    expect(contacts[0].displayName).toBe("La Boss");
  });

  it("un nom vu une seule fois suffit à nommer le contact", () => {
    const contacts = buildContacts(
      [
        ev({ id: "a", attendees: [{ email: "paul@client.fr" }] }),
        ev({ id: "b", attendees: [{ email: "paul@client.fr", displayName: "Paul Martin" }] }),
      ],
      MOI
    );
    expect(contacts[0].displayName).toBe("Paul Martin");
  });

  it("les plus récents d'abord", () => {
    const contacts = buildContacts(
      [
        ev({ id: "a", start: "2026-01-05T09:00:00", attendees: [{ email: "vieux@x.fr" }] }),
        ev({ id: "b", start: "2026-06-05T09:00:00", attendees: [{ email: "recent@x.fr" }] }),
      ],
      MOI
    );
    expect(contacts.map((c) => c.email)).toEqual(["recent@x.fr", "vieux@x.fr"]);
  });
});

describe("searchContacts — retrouver quelqu'un par son nom", () => {
  const annuaire = buildContacts(
    [
      ev({
        id: "a",
        start: "2026-01-05T09:00:00",
        attendees: [{ email: "paul.martin@client.fr", displayName: "Paul Martin" }],
      }),
      ev({
        id: "b",
        start: "2026-02-05T09:00:00",
        attendees: [{ email: "paulineb@autre.fr", displayName: "Pauline Bernard" }],
      }),
      ev({ id: "c", start: "2026-03-05T09:00:00", attendees: [{ email: "gael@x.fr" }] }),
    ],
    MOI
  );

  it("un prénom exact passe devant un simple préfixe", () => {
    expect(searchContacts(annuaire, "Paul").map((c) => c.email)).toEqual([
      "paul.martin@client.fr",
      "paulineb@autre.fr",
    ]);
  });

  it("l'accent ne compte pas", () => {
    expect(searchContacts(annuaire, "Gaël").map((c) => c.email)).toEqual(["gael@x.fr"]);
  });

  it("un fragment d'email marche aussi", () => {
    expect(searchContacts(annuaire, "client.fr").map((c) => c.email)).toEqual([
      "paul.martin@client.fr",
    ]);
  });

  it("rien de connu → aucune invention", () => {
    expect(searchContacts(annuaire, "Jean-Kevin")).toEqual([]);
  });

  it("sans requête : les plus récents, dans la limite demandée", () => {
    expect(searchContacts(annuaire, "", 2).map((c) => c.email)).toEqual([
      "gael@x.fr",
      "paulineb@autre.fr",
    ]);
  });
});

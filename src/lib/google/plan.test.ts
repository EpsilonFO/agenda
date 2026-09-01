import { describe, expect, it } from "vitest";
import type { EventItem } from "../types";
import type { GoogleAccount } from "./accounts";
import { EXT_HASH, EXT_ID, hashBody, projectLocalEvent } from "./mapping";
import { planAccountSync, type PlanInput, type RemoteOp } from "./plan";
import type { Tombstone } from "./tombstones";
import type { GoogleEvent } from "./types";

const TZ = "Europe/Paris";
const NOW = new Date("2026-09-01T10:00:00.000Z");
const NOW_ISO = NOW.toISOString();
const WINDOW = {
  start: new Date(NOW.getTime() - 14 * 86_400_000),
  end: new Date(NOW.getTime() + 90 * 86_400_000),
};

function account(over: Partial<GoogleAccount> = {}): GoogleAccount {
  return {
    id: "acc-A",
    email: "felix@delos.fr",
    refreshToken: "r",
    calendarId: "primary",
    push: true,
    pull: true,
    detail: "full",
    busyTitle: "Occupé",
    category: "travail",
    excludeCategories: [],
    status: "ok",
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    ...over,
  };
}

function local(over: Partial<EventItem> = {}): EventItem {
  return {
    id: "loc-1",
    title: "Monumia",
    start: "2026-09-02T14:00:00",
    end: "2026-09-02T18:00:00",
    category: "monumia",
    createdAt: "2026-08-20T10:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
    ...over,
  };
}

/** Notre copie Google d'un événement local, telle que la synchro l'aurait créée. */
function copyOf(ev: EventItem, acc: GoogleAccount, over: Partial<GoogleEvent> = {}): GoogleEvent {
  const invite = Boolean(ev.attendees?.length && ev.invite?.accountId === acc.id);
  const body = projectLocalEvent(ev, { detail: acc.detail, busyTitle: acc.busyTitle, withAttendees: invite, tz: TZ });
  return {
    id: `copy-${ev.id}`,
    status: "confirmed",
    summary: body.summary,
    start: body.start,
    end: body.end,
    extendedProperties: body.extendedProperties,
    ...(body.attendees ? { attendees: body.attendees } : {}),
    ...over,
  };
}

function foreign(over: Partial<GoogleEvent> = {}): GoogleEvent {
  return {
    id: "g-1",
    status: "confirmed",
    summary: "Réunion produit",
    start: { dateTime: "2026-09-03T07:00:00Z" },
    end: { dateTime: "2026-09-03T08:00:00Z" },
    updated: "2026-08-30T12:00:00.000Z",
    organizer: { email: "boss@delos.fr" },
    attendees: [
      { email: "boss@delos.fr", organizer: true, responseStatus: "accepted" },
      { email: "felix@delos.fr", self: true, responseStatus: "needsAction" },
    ],
    ...over,
  };
}

function run(over: Partial<PlanInput> = {}) {
  const input: PlanInput = {
    account: account(),
    local: [],
    remote: [],
    tombstones: [],
    window: WINDOW,
    tz: TZ,
    now: NOW,
    ...over,
  };
  return planAccountSync(input);
}

const kinds = (ops: RemoteOp[]) => ops.map((o) => o.kind);

describe("planAccountSync — push (agenda → Google)", () => {
  it("événement local sans copie → insert marqué", () => {
    const ev = local();
    const plan = run({ local: [ev] });
    expect(plan.remote).toHaveLength(1);
    const op = plan.remote[0];
    expect(op.kind).toBe("insert");
    if (op.kind !== "insert") return;
    expect(op.localId).toBe("loc-1");
    expect(op.body.extendedProperties.private[EXT_ID]).toBe("loc-1");
    expect(op.sendUpdates).toBe(false);
    expect(plan.local).toEqual([]);
  });

  it("copie à jour → rien ; copie différente → patch", () => {
    const acc = account();
    const ev = local();
    expect(run({ local: [ev], remote: [copyOf(ev, acc)] }).remote).toEqual([]);

    const stale = copyOf(ev, acc, {
      extendedProperties: { private: { [EXT_ID]: ev.id, [EXT_HASH]: "vieux" } },
    });
    const plan = run({ local: [ev], remote: [stale] });
    expect(kinds(plan.remote)).toEqual(["patch"]);
    const op = plan.remote[0];
    if (op.kind === "patch") {
      expect(op.googleId).toBe("copy-loc-1");
      expect(op.body.extendedProperties.private[EXT_HASH]).toBe(hashBody(op.body));
    }
  });

  it("copie orpheline (événement local disparu, ex. plan réécrit) → delete", () => {
    const acc = account();
    const gone = local({ id: "loc-gone" });
    const plan = run({ local: [], remote: [copyOf(gone, acc)] });
    expect(plan.remote).toEqual([
      { kind: "delete", googleId: "copy-loc-gone", sendUpdates: false, reason: "orphan" },
    ]);
  });

  it("copie orpheline avec invités → delete notifié", () => {
    const acc = account();
    const gone = local({ id: "loc-gone", attendees: [{ email: "a@x.fr" }], invite: { accountId: acc.id } });
    const plan = run({ local: [], remote: [copyOf(gone, acc)] });
    expect(plan.remote[0]).toMatchObject({ kind: "delete", sendUpdates: true });
  });

  it("copie annulée côté Google alors que l'événement local existe → recréée (jamais mirroir de la suppression)", () => {
    const acc = account();
    const ev = local();
    const plan = run({ local: [ev], remote: [copyOf(ev, acc, { status: "cancelled" })] });
    expect(kinds(plan.remote)).toEqual(["insert"]);
    expect(plan.local).toEqual([]);
  });

  it("doublons de copie → on garde la première, on supprime les autres", () => {
    const acc = account();
    const ev = local();
    const plan = run({ local: [ev], remote: [copyOf(ev, acc), copyOf(ev, acc, { id: "copy-dup" })] });
    expect(plan.remote).toEqual([
      { kind: "delete", googleId: "copy-dup", sendUpdates: false, reason: "duplicate" },
    ]);
  });

  it("catégorie exclue → pas poussée, copie existante supprimée", () => {
    const acc = account({ excludeCategories: ["repas"] });
    const lunch = local({ id: "loc-lunch", category: "Repas" });
    const plan = run({ account: acc, local: [lunch], remote: [copyOf(lunch, account())] });
    expect(plan.remote).toEqual([
      { kind: "delete", googleId: "copy-loc-lunch", sendUpdates: false, reason: "orphan" },
    ]);
  });

  it("hors fenêtre → ignoré (ni insert ni delete)", () => {
    const acc = account();
    const old = local({ id: "loc-old", start: "2026-01-05T09:00:00", end: "2026-01-05T10:00:00" });
    const plan = run({ local: [old], remote: [] });
    expect(plan.remote).toEqual([]);
    // Une copie hors fenêtre ne serait de toute façon pas renvoyée par Google.
    expect(run({ local: [], remote: [copyOf(old, acc)] }).remote).toHaveLength(1);
  });

  it("push désactivé → toutes les copies vivantes sont retirées, rien n'est inséré", () => {
    const acc = account({ push: false });
    const ev = local();
    const plan = run({ account: acc, local: [ev], remote: [copyOf(ev, account())] });
    expect(plan.remote).toEqual([
      { kind: "delete", googleId: "copy-loc-1", sendUpdates: false, reason: "push-off" },
    ]);
  });

  it("mode occupé : la copie est un bloc privé « Occupé »", () => {
    const plan = run({ account: account({ detail: "busy" }), local: [local()] });
    const op = plan.remote[0];
    if (op.kind === "insert") {
      expect(op.body.summary).toBe("Occupé");
      expect(op.body.visibility).toBe("private");
    } else {
      throw new Error("insert attendu");
    }
  });
});

describe("planAccountSync — miroir entre comptes", () => {
  const accA = account({ id: "acc-A" });
  const accB = account({ id: "acc-B", email: "felix@gmail.com" });
  const importedFromA = local({
    id: "loc-imp",
    title: "Réunion produit",
    source: "google",
    google: { accountId: "acc-A", calendarId: "primary", eventId: "g-1", updated: "2026-08-30T12:00:00.000Z", syncedAt: NOW_ISO },
  });

  it("un importé du compte A n'est pas renvoyé vers A (écho) mais poussé vers B", () => {
    expect(run({ account: accA, local: [importedFromA], remote: [foreign()] }).remote).toEqual([]);
    const planB = run({ account: accB, local: [importedFromA], remote: [] });
    expect(kinds(planB.remote)).toEqual(["insert"]);
  });
});

describe("planAccountSync — pull (Google → agenda)", () => {
  it("événement étranger → création locale source google, catégorie du compte", () => {
    const plan = run({ account: account({ category: "delos" }), remote: [foreign()] });
    expect(plan.remote).toEqual([]);
    expect(plan.local).toHaveLength(1);
    const op = plan.local[0];
    expect(op.kind).toBe("create");
    if (op.kind !== "create") return;
    expect(op.event).toMatchObject({
      title: "Réunion produit",
      start: "2026-09-03T09:00:00",
      end: "2026-09-03T10:00:00",
      category: "delos",
      source: "google",
      google: { accountId: "acc-A", eventId: "g-1", myResponse: "needsAction", syncedAt: NOW_ISO },
    });
  });

  it("journée entière, refusé, annulé → non importés ; supprimés localement s'ils existaient", () => {
    const existing = local({
      id: "loc-g1",
      source: "google",
      google: { accountId: "acc-A", calendarId: "primary", eventId: "g-1", syncedAt: NOW_ISO },
    });
    expect(run({ remote: [foreign({ start: { date: "2026-09-03" }, end: { date: "2026-09-04" } })] }).local).toEqual([]);
    expect(run({ remote: [foreign({ status: "cancelled" })] }).local).toEqual([]);
    const plan = run({
      local: [existing],
      remote: [foreign({ attendees: [{ email: "felix@delos.fr", self: true, responseStatus: "declined" }] })],
    });
    expect(plan.local).toEqual([{ kind: "delete", id: "loc-g1", reason: "declined" }]);
  });

  it("modifié côté Google seulement → mise à jour locale", () => {
    const existing = local({
      id: "loc-g1",
      title: "Réunion produit",
      start: "2026-09-03T09:00:00",
      end: "2026-09-03T10:00:00",
      source: "google",
      updatedAt: "2026-08-30T12:00:00.000Z",
      google: { accountId: "acc-A", calendarId: "primary", eventId: "g-1", updated: "2026-08-30T12:00:00.000Z", syncedAt: "2026-08-30T12:00:00.000Z" },
    });
    const moved = foreign({
      updated: "2026-08-31T09:00:00.000Z",
      start: { dateTime: "2026-09-03T12:00:00Z" },
      end: { dateTime: "2026-09-03T13:00:00Z" },
    });
    const plan = run({ local: [existing], remote: [moved] });
    expect(plan.remote).toEqual([]);
    expect(plan.local).toHaveLength(1);
    expect(plan.local[0]).toMatchObject({
      kind: "update",
      id: "loc-g1",
      patch: { start: "2026-09-03T14:00:00", end: "2026-09-03T15:00:00", updatedAt: NOW_ISO },
    });
    if (plan.local[0].kind === "update") {
      expect(plan.local[0].patch.google).toMatchObject({ updated: "2026-08-31T09:00:00.000Z", syncedAt: NOW_ISO });
    }
  });

  it("inchangé des deux côtés → aucune opération", () => {
    const existing = local({
      id: "loc-g1",
      title: "Réunion produit",
      start: "2026-09-03T09:00:00",
      end: "2026-09-03T10:00:00",
      source: "google",
      updatedAt: "2026-08-30T12:00:00.000Z",
      google: { accountId: "acc-A", calendarId: "primary", eventId: "g-1", updated: "2026-08-30T12:00:00.000Z", syncedAt: "2026-08-30T12:00:00.000Z" },
    });
    const plan = run({ local: [existing], remote: [foreign()] });
    expect(plan.remote).toEqual([]);
    expect(plan.local).toEqual([]);
  });

  it("modifié localement seulement (déplacé) → renvoyé à Google, rien en local", () => {
    const existing = local({
      id: "loc-g1",
      title: "Réunion produit",
      start: "2026-09-03T15:00:00",
      end: "2026-09-03T16:00:00",
      source: "google",
      updatedAt: "2026-08-31T20:00:00.000Z",
      google: { accountId: "acc-A", calendarId: "primary", eventId: "g-1", updated: "2026-08-30T12:00:00.000Z", syncedAt: "2026-08-30T12:00:00.000Z" },
    });
    const plan = run({ local: [existing], remote: [foreign()] });
    expect(plan.local).toEqual([]);
    expect(plan.remote).toEqual([
      {
        kind: "patch-origin",
        googleId: "g-1",
        localId: "loc-g1",
        body: {
          start: { dateTime: "2026-09-03T15:00:00+02:00", timeZone: TZ },
          end: { dateTime: "2026-09-03T16:00:00+02:00", timeZone: TZ },
        },
        sendUpdates: true,
      },
    ]);
  });

  it("modification locale sans effet (couleur) → on referme juste le marqueur", () => {
    const existing = local({
      id: "loc-g1",
      title: "Réunion produit",
      start: "2026-09-03T09:00:00",
      end: "2026-09-03T10:00:00",
      source: "google",
      updatedAt: "2026-08-31T20:00:00.000Z",
      google: { accountId: "acc-A", calendarId: "primary", eventId: "g-1", updated: "2026-08-30T12:00:00.000Z", syncedAt: "2026-08-30T12:00:00.000Z" },
    });
    const plan = run({ local: [existing], remote: [foreign()] });
    expect(plan.remote).toEqual([]);
    expect(plan.local).toHaveLength(1);
    expect(plan.local[0]).toMatchObject({ kind: "update", id: "loc-g1", patch: { updatedAt: NOW_ISO } });
  });

  it("modifié des deux côtés → Google gagne, avec avertissement", () => {
    const existing = local({
      id: "loc-g1",
      title: "Réunion produit (déplacée par moi)",
      start: "2026-09-03T15:00:00",
      end: "2026-09-03T16:00:00",
      source: "google",
      updatedAt: "2026-08-31T20:00:00.000Z",
      google: { accountId: "acc-A", calendarId: "primary", eventId: "g-1", updated: "2026-08-30T12:00:00.000Z", syncedAt: "2026-08-30T12:00:00.000Z" },
    });
    const plan = run({ local: [existing], remote: [foreign({ updated: "2026-08-31T21:00:00.000Z", summary: "Réunion produit v2" })] });
    expect(plan.remote).toEqual([]);
    expect(plan.local[0]).toMatchObject({ kind: "update", id: "loc-g1", patch: { title: "Réunion produit v2" } });
    expect(plan.warnings).toHaveLength(1);
  });

  it("importé absent de Google dans la fenêtre → supprimé localement ; hors fenêtre → gardé", () => {
    const inWin = local({
      id: "loc-in",
      source: "google",
      google: { accountId: "acc-A", calendarId: "primary", eventId: "g-in", syncedAt: NOW_ISO },
    });
    const outWin = local({
      id: "loc-out",
      start: "2026-01-05T09:00:00",
      end: "2026-01-05T10:00:00",
      source: "google",
      google: { accountId: "acc-A", calendarId: "primary", eventId: "g-out", syncedAt: NOW_ISO },
    });
    const otherAccount = local({
      id: "loc-other",
      source: "google",
      google: { accountId: "acc-B", calendarId: "primary", eventId: "g-b", syncedAt: NOW_ISO },
    });
    const plan = run({ local: [inWin, outWin, otherAccount], remote: [] });
    expect(plan.local).toEqual([{ kind: "delete", id: "loc-in", reason: "absent de Google" }]);
    // L'importé d'un AUTRE compte est poussé ici comme n'importe quel événement.
    expect(kinds(plan.remote)).toEqual(["insert"]);
  });

  it("pull désactivé → rien n'est importé ni supprimé localement", () => {
    const existing = local({
      id: "loc-g1",
      source: "google",
      google: { accountId: "acc-A", calendarId: "primary", eventId: "g-old", syncedAt: NOW_ISO },
    });
    const plan = run({ account: account({ pull: false }), local: [existing], remote: [foreign()] });
    expect(plan.local).toEqual([]);
  });
});

describe("planAccountSync — invitations envoyées depuis l'agenda", () => {
  const acc = account();
  const meeting = local({
    id: "loc-meet",
    title: "Point Delos",
    attendees: [{ email: "alice@delos.fr" }, { email: "bob@delos.fr" }],
    invite: { accountId: acc.id },
  });

  it("insert avec invités et notification", () => {
    const plan = run({ local: [meeting] });
    const op = plan.remote[0];
    expect(op.kind).toBe("insert");
    if (op.kind !== "insert") return;
    expect(op.sendUpdates).toBe(true);
    expect(op.invite).toBe(true);
    expect(op.body.attendees).toEqual([{ email: "alice@delos.fr" }, { email: "bob@delos.fr" }]);
  });

  it("sur un autre compte : copie simple, sans invités", () => {
    const plan = run({ account: account({ id: "acc-B" }), local: [meeting] });
    const op = plan.remote[0];
    if (op.kind === "insert") {
      expect(op.body.attendees).toBeUndefined();
      expect(op.sendUpdates).toBe(false);
    } else {
      throw new Error("insert attendu");
    }
  });

  it("réponses des invités lues sur la copie → mise à jour locale (sans re-patch)", () => {
    const copy = copyOf(meeting, acc, {
      htmlLink: "https://calendar.google.com/event?eid=meet",
      attendees: [
        { email: "felix@delos.fr", self: true, organizer: true, responseStatus: "accepted" },
        { email: "alice@delos.fr", responseStatus: "accepted" },
        { email: "bob@delos.fr", responseStatus: "tentative" },
      ],
    });
    const plan = run({ local: [meeting], remote: [copy] });
    expect(plan.remote).toEqual([]);
    expect(plan.local).toEqual([
      {
        kind: "update",
        id: "loc-meet",
        patch: {
          attendees: [
            { email: "alice@delos.fr", responseStatus: "accepted" },
            { email: "bob@delos.fr", responseStatus: "tentative" },
          ],
          invite: {
            accountId: acc.id,
            eventId: "copy-loc-meet",
            htmlLink: "https://calendar.google.com/event?eid=meet",
            sentAt: NOW_ISO,
          },
        },
      },
    ]);
  });

  it("invité ajouté localement → patch notifié qui garde les réponses connues", () => {
    const withCarol = { ...meeting, attendees: [...meeting.attendees!, { email: "carol@delos.fr" }] };
    const copy = copyOf(meeting, acc, {
      attendees: [
        { email: "felix@delos.fr", self: true, organizer: true, responseStatus: "accepted" },
        { email: "alice@delos.fr", responseStatus: "accepted" },
        { email: "bob@delos.fr", responseStatus: "needsAction" },
      ],
    });
    const plan = run({ local: [withCarol], remote: [copy] });
    expect(kinds(plan.remote)).toEqual(["patch"]);
    const op = plan.remote[0];
    if (op.kind === "patch") {
      expect(op.sendUpdates).toBe(true);
      expect(op.body.attendees).toEqual([
        { email: "alice@delos.fr", responseStatus: "accepted" },
        { email: "bob@delos.fr", responseStatus: "needsAction" },
        { email: "carol@delos.fr" },
      ]);
    }
  });
});

describe("planAccountSync — pierres tombales", () => {
  it("suppression locale d'un importé → delete côté Google (notifié), autres comptes ignorés", () => {
    const tombs: Tombstone[] = [
      { accountId: "acc-A", calendarId: "primary", eventId: "g-1", deletedAt: NOW_ISO },
      { accountId: "acc-B", calendarId: "primary", eventId: "g-9", deletedAt: NOW_ISO },
    ];
    const plan = run({ tombstones: tombs, remote: [foreign()] });
    // L'événement supprimé localement est encore dans Google : il ne doit
    // PAS être ré-importé pendant que la tombe attend d'être jouée.
    expect(plan.local).toEqual([]);
    expect(plan.remote).toEqual([
      { kind: "delete", googleId: "g-1", sendUpdates: true, reason: "tombstone", tombstone: tombs[0] },
    ]);
  });
});

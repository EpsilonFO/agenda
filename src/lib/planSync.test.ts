import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { syncPlanWithAgenda, withUniqueSessionIds } from "./planSync";
import { testConfig } from "./planner/__fixtures__/testConfig";
import type { EventItem, PlannedSession, WeekPlan } from "./types";

/**
 * Une retouche faite à la main survit à la retouche suivante de Josiane.
 *
 * Vécu : planning posé, deux blocs déplacés à la main, puis une demande à
 * Josiane — elle a remis toute la semaine comme le solveur l'avait faite, car
 * elle opérait sur le plan stocké, que les retouches à la main ne touchaient
 * pas.
 */

const WEEK = "2026-09-28";

function session(over: Partial<PlannedSession>): PlannedSession {
  return {
    title: "Monumia",
    category: "monumia",
    start: `${WEEK}T09:00:00`,
    end: `${WEEK}T12:00:00`,
    ...over,
  };
}

function event(over: Partial<EventItem>): EventItem {
  return {
    id: "ev",
    title: "Monumia",
    category: "monumia",
    start: `${WEEK}T09:00:00`,
    end: `${WEEK}T12:00:00`,
    source: "plan",
    createdAt: "2026-09-27T10:00:00",
    updatedAt: "2026-09-27T10:00:00",
    ...over,
  };
}

function plan(sessions: PlannedSession[]): WeekPlan {
  return { weekStart: WEEK, sessions, committed: true };
}

describe("syncPlanWithAgenda", () => {
  it("reprend le déplacement fait à la main, par le lien planSessionId", () => {
    const res = syncPlanWithAgenda(plan([session({ id: "s1" })]), [
      event({ id: "e1", planSessionId: "s1", start: `${WEEK}T14:00:00`, end: `${WEEK}T17:00:00` }),
    ]);
    expect(res.changed).toBe(true);
    expect(res.plan.sessions).toEqual([
      session({ id: "s1", start: `${WEEK}T14:00:00`, end: `${WEEK}T17:00:00` }),
    ]);
    expect(res.links).toEqual([]);
  });

  it("ne change rien quand l'agenda montre déjà le plan", () => {
    const stored = plan([session({ id: "s1" })]);
    const res = syncPlanWithAgenda(stored, [event({ id: "e1", planSessionId: "s1" })]);
    expect(res.changed).toBe(false);
    expect(res.plan.sessions).toEqual(stored.sessions);
  });

  it("retire du plan une séance supprimée à la main", () => {
    const res = syncPlanWithAgenda(
      plan([session({ id: "s1" }), session({ id: "s2", start: `${WEEK}T14:00:00`, end: `${WEEK}T17:00:00` })]),
      [event({ id: "e1", planSessionId: "s1" })]
    );
    expect(res.plan.sessions.map((s) => s.id)).toEqual(["s1"]);
    expect(res.changed).toBe(true);
  });

  it("ignore les événements qui ne viennent pas d'un plan", () => {
    const res = syncPlanWithAgenda(plan([session({ id: "s1" })]), [
      event({ id: "e1", planSessionId: "s1" }),
      event({ id: "copie", source: undefined, start: `${WEEK}T14:00:00`, end: `${WEEK}T17:00:00` }),
    ]);
    expect(res.changed).toBe(false);
    expect(res.plan.sessions).toHaveLength(1);
  });

  it("relie les événements écrits avant le lien : même créneau, puis même titre au plus proche", () => {
    const res = syncPlanWithAgenda(
      plan([
        session({ start: `${WEEK}T09:00:00`, end: `${WEEK}T12:00:00` }),
        session({ start: "2026-09-30T09:00:00", end: "2026-09-30T12:00:00" }),
      ]),
      [
        event({ id: "tel-quel" }),
        // Bloc du mercredi glissé à la main à jeudi.
        event({ id: "deplace", start: "2026-10-01T10:00:00", end: "2026-10-01T13:00:00" }),
      ]
    );
    expect(res.plan.sessions.map((s) => [s.id, s.start])).toEqual([
      ["r1", `${WEEK}T09:00:00`],
      ["r2", "2026-10-01T10:00:00"],
    ]);
    expect(res.links).toEqual([
      { eventId: "tel-quel", sessionId: "r1" },
      { eventId: "deplace", sessionId: "r2" },
    ]);
  });

  it("recatégorise et relocalise d'après l'événement", () => {
    const res = syncPlanWithAgenda(
      plan([session({ id: "s1", placeId: "bibli", placeName: "Bibli" })]),
      [event({ id: "e1", planSessionId: "s1", category: "perso", location: "Salle" })],
      (loc) => (loc === "Salle" ? "salle" : undefined)
    );
    expect(res.plan.sessions[0]).toMatchObject({
      category: "perso",
      placeName: "Salle",
      placeId: "salle",
    });
  });
});

describe("withUniqueSessionIds", () => {
  it("numérote les séances sans id et départage les doublons", () => {
    expect(
      withUniqueSessionIds([session({}), session({ id: "a" }), session({ id: "a" })]).map((s) => s.id)
    ).toEqual(["r1", "a", "a-2"]);
  });
});

/* ------------------ De bout en bout, sur le stockage ------------------ */

process.chdir(await fs.mkdtemp(path.join(os.tmpdir(), "agenda-plansync-")));
await fs.mkdir("data");
await fs.writeFile("data/life-config.json", JSON.stringify(testConfig));
const store = await import("./store");
const { commitWeekPlan } = await import("./commit");
const { applyPlanOpsFromStore, listPlanSessionsFromStore } = await import("./planner/council");

describe("retouche à la main puis retouche par Josiane", () => {
  it("garde le travail fait à la main, et l'événement retouché garde sa checklist", async () => {
    await commitWeekPlan(
      plan([
        session({ id: "sol-1-monumia", placeId: "bibli", placeName: "Bibli" }),
        session({
          id: "sol-2-sport",
          title: "Muscu",
          category: "sport",
          placeId: "salle",
          placeName: "Salle",
          start: "2026-09-30T18:00:00",
          end: "2026-09-30T19:00:00",
        }),
        session({
          id: "sol-3-monumia",
          placeId: "bibli",
          placeName: "Bibli",
          start: "2026-10-01T14:00:00",
          end: "2026-10-01T17:00:00",
        }),
      ])
    );
    const written = await store.listEvents();
    expect(written.map((e) => e.planSessionId)).toEqual(["sol-1-monumia", "sol-2-sport", "sol-3-monumia"]);
    const [lundi, muscu, jeudi] = written;

    // À la main : le bloc du lundi décalé d'une heure, celui du jeudi supprimé,
    // une case à cocher sur la muscu.
    await store.updateEvent(lundi.id, { start: `${WEEK}T10:00:00`, end: `${WEEK}T13:00:00` });
    await store.deleteEvent(jeudi.id);
    await store.updateEvent(muscu.id, {
      checklist: [{ id: "c1", text: "prendre la gourde", done: false }],
    });

    // Josiane voit l'agenda tel qu'il est…
    const seen = await listPlanSessionsFromStore(WEEK);
    expect(seen?.sessions.map((s) => [s.id, s.start])).toEqual([
      ["sol-1-monumia", `${WEEK}T10:00:00`],
      ["sol-2-sport", "2026-09-30T18:00:00"],
    ]);

    // … et sa retouche (muscu → jeudi) ne défait rien.
    const applied = await applyPlanOpsFromStore(WEEK, [
      { op: "move", sessionId: "sol-2-sport", day: "2026-10-01", start: "18:00", end: "19:00" },
    ]);
    await commitWeekPlan(applied!.plan);

    const after = (await store.listEvents()).filter((e) => e.category !== "trajet");
    expect(after.map((e) => [e.title, e.start, e.end])).toEqual([
      ["Monumia", `${WEEK}T10:00:00`, `${WEEK}T13:00:00`],
      ["Muscu", "2026-10-01T18:00:00", "2026-10-01T19:00:00"],
    ]);
    // Mise à jour en place : même événement, checklist intacte.
    expect(after[0].id).toBe(lundi.id);
    expect(after[1].id).toBe(muscu.id);
    expect(after[1].checklist).toEqual([{ id: "c1", text: "prendre la gourde", done: false }]);
  });
});

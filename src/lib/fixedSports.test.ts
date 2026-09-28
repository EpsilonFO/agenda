import { describe, expect, it } from "vitest";
import { fixedSportPreviews } from "./fixedSports";
import type { EventItem } from "./types";

const cfg = {
  places: [{ id: "piscine", name: "Piscine de la fac", cluster: "orsay", forbiddenModes: [], sleepable: false }],
  sport: {
    sessionsPerWeekMin: 2,
    sessionsPerWeekMax: 4,
    bufferAfterMin: 15,
    activities: [
      {
        id: "natation",
        name: "Natation",
        status: "impose",
        perWeek: 1,
        placeIds: ["piscine"],
        durationMin: 60,
        intensity: "moderate",
        minRestHours: 24,
        morningOk: false,
        fixedSlot: { weekday: "jeudi", start: "18:00", end: "19:00" },
        openingHours: null,
        rushHours: null,
      },
      {
        id: "salle",
        name: "Salle",
        status: "voulu",
        perWeek: 2,
        placeIds: [],
        durationMin: 60,
        intensity: "high",
        minRestHours: 24,
        morningOk: false,
        fixedSlot: { weekday: "jeudi", start: "12:00", end: "13:00" },
        openingHours: null,
        rushHours: null,
      },
    ],
  },
} as unknown as Parameters<typeof fixedSportPreviews>[0];

// Semaine du lundi 28/09/2026 ; « maintenant » = lundi matin.
const monday = new Date(2026, 8, 28);
const week = Array.from({ length: 7 }, (_, i) => new Date(2026, 8, 28 + i));
const now = new Date(2026, 8, 28, 8, 0);

function ev(partial: Partial<EventItem>): EventItem {
  return {
    id: "e1",
    title: "x",
    start: "2026-10-01T18:00:00",
    end: "2026-10-01T19:00:00",
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

describe("fixedSportPreviews", () => {
  it("montre le sport imposé à son créneau, et lui seul", () => {
    const out = fixedSportPreviews(cfg, week, [], now);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      title: "Natation",
      start: "2026-10-01T18:00:00",
      end: "2026-10-01T19:00:00",
      category: "sport",
      location: "Piscine de la fac",
      preview: true,
    });
  });

  it("s'efface quand un événement de sport occupe déjà le créneau", () => {
    const planned = ev({ category: "sport", title: "Natation" });
    expect(fixedSportPreviews(cfg, week, [planned], now)).toEqual([]);
    const shifted = ev({ title: "Natation", start: "2026-10-01T18:30:00", end: "2026-10-01T19:30:00" });
    expect(fixedSportPreviews(cfg, week, [shifted], now)).toEqual([]);
  });

  it("reste affiché à côté d'un événement qui n'est pas du sport", () => {
    const other = ev({ category: "perso", title: "Apéro" });
    expect(fixedSportPreviews(cfg, week, [other], now)).toHaveLength(1);
  });

  it("rien pour les jours passés", () => {
    const friday = new Date(2026, 9, 2, 9, 0);
    expect(fixedSportPreviews(cfg, week, [], friday)).toEqual([]);
    expect(fixedSportPreviews(cfg, [monday], [], now)).toEqual([]);
  });
});

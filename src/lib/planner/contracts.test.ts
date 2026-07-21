import { describe, expect, it } from "vitest";
import {
  DjimoOutSchema,
  EmilienOutSchema,
  JosianeOutSchema,
  WeekInputSchema,
} from "./contracts";

describe("WeekInput", () => {
  it("accepte une demande minimale (défauts appliqués)", () => {
    const input = WeekInputSchema.parse({ weekStart: "2026-07-20" });
    expect(input.imprevus).toEqual([]);
    expect(input.voitureDispo).toBe(true);
    expect(input.overrides).toEqual({});
  });

  it("accepte une demande complète avec overrides", () => {
    const input = WeekInputSchema.parse({
      weekStart: "2026-07-20",
      notes: "semaine chargée",
      imprevus: [{ label: "TP optim", hoursNeeded: 4, deadline: "2026-07-24" }],
      sortiesDatees: [
        { label: "Dîner Marine", withWhom: "marine", day: "2026-07-24", start: "20:00" },
      ],
      indisponibilites: [{ day: "2026-07-26", reason: "chez les parents" }],
      voitureDispo: false,
      overrides: { sortiesMarineMin: 0 },
    });
    expect(input.overrides.sortiesMarineMin).toBe(0);
    expect(input.sortiesDatees[0].withWhom).toBe("marine");
  });

  it("rejette une date mal formée", () => {
    expect(() => WeekInputSchema.parse({ weekStart: "lundi prochain" })).toThrow();
  });
});

describe("sorties d'agents", () => {
  it("EmilienOut : valide et applique les défauts", () => {
    const out = EmilienOutSchema.parse({
      delos: { halfDays: 3 },
      monumia: { targetHours: 24 },
      imprevus: [{ label: "TP", hours: 4 }],
      summary: "ok",
      messageToJosiane: "3 demi-journées Delos, 24h Monumia.",
    });
    expect(out.delos.preference).toBe("");
    expect(out.imprevus[0].deadline).toBeNull();
    expect(out.imprevus[0].priority).toBe("normale");
  });

  it("DjimoOut : rejette un withWhom inconnu", () => {
    expect(() =>
      DjimoOutSchema.parse({
        sorties: [{ label: "Soirée", withWhom: "collègues" }],
      })
    ).toThrow();
  });

  it("JosianeOut : valide des sessions placées", () => {
    const out = JosianeOutSchema.parse({
      sessions: [
        {
          title: "Delos",
          category: "delos",
          placeId: "delos",
          day: "2026-07-20",
          start: "09:00",
          end: "13:00",
        },
      ],
    });
    expect(out.sessions[0].exceptional).toBe(false);
    expect(out.warnings).toEqual([]);
  });

  it("JosianeOut : rejette une heure invalide", () => {
    expect(() =>
      JosianeOutSchema.parse({
        sessions: [
          {
            title: "Delos",
            category: "delos",
            day: "2026-07-20",
            start: "9h",
            end: "13:00",
          },
        ],
      })
    ).toThrow();
  });
});

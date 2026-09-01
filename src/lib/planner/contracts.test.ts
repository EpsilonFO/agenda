import { describe, expect, it } from "vitest";
import { JosianeRetouchOutSchema, RetouchOpSchema, WeekInputSchema } from "./contracts";

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

  it("sport (v5) : défauts vides, surcharge hebdo acceptée", () => {
    const minimal = WeekInputSchema.parse({ weekStart: "2026-07-20" });
    expect(minimal.sport).toEqual({ exclure: [], imposer: [] });

    const input = WeekInputSchema.parse({
      weekStart: "2026-07-20",
      sport: { exclure: ["natation"], imposer: [{ activityId: "escalade" }] },
    });
    expect(input.sport.exclure).toEqual(["natation"]);
    expect(input.sport.imposer).toEqual([{ activityId: "escalade", fois: 1 }]);
  });

  it("sport (v5) : borne le nombre de fois", () => {
    expect(() =>
      WeekInputSchema.parse({
        weekStart: "2026-07-20",
        sport: { imposer: [{ activityId: "course", fois: 9 }] },
      })
    ).toThrow();
  });
});

describe("retouche", () => {
  it("RetouchOp : union discriminée move/remove/add", () => {
    expect(
      RetouchOpSchema.parse({
        op: "move",
        sessionId: "s1",
        day: "2026-07-20",
        start: "10:00",
        end: "12:00",
      }).op
    ).toBe("move");
    expect(() => RetouchOpSchema.parse({ op: "move", sessionId: "s1" })).toThrow();
    expect(RetouchOpSchema.parse({ op: "remove", sessionId: "s1" }).op).toBe("remove");
  });

  it("JosianeRetouchOut : catégorie tolérante au français naturel", () => {
    const out = JosianeRetouchOutSchema.parse({
      operations: [
        {
          op: "add",
          session: {
            title: "Dîner",
            category: "Déjeuner",
            day: "2026-07-20",
            start: "12:00",
            end: "13:00",
          },
        },
      ],
    });
    const add = out.operations[0];
    expect(add.op === "add" && add.session.category).toBe("repas");
  });
});

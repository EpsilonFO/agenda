import { describe, expect, it } from "vitest";
import { loadLifeConfig, parseLifeConfig, travelMinutes, type LifeConfig } from "./config";

describe("data/life-config.json", () => {
  it("se charge et passe la validation zod (quel que soit son contenu du moment)", async () => {
    // On ne vérifie pas les valeurs : Felix édite ce fichier librement.
    // Seule la STRUCTURE doit rester valide.
    const cfg = await loadLifeConfig();
    expect(cfg.version).toBe(1);
    expect(cfg.clusters.length).toBeGreaterThan(0);
    expect(cfg.places.length).toBeGreaterThan(0);
  });
});

describe("travelMinutes (fixture indépendante du JSON réel)", () => {
  const cfg: LifeConfig = parseLifeConfig({
    version: 1,
    clusters: [
      { id: "orsay", name: "Orsay", intraTravelMin: 15 },
      { id: "paris", name: "Paris", intraTravelMin: 25 },
    ],
    places: [
      { id: "chambre", name: "Chambre", cluster: "orsay", forbiddenModes: [], sleepable: true },
      { id: "fac", name: "Fac", cluster: "orsay", forbiddenModes: [], sleepable: false },
      { id: "maison", name: "Maison", cluster: "paris", forbiddenModes: [], sleepable: true },
      { id: "delos", name: "Delos", cluster: "paris", forbiddenModes: ["voiture"], sleepable: false },
    ],
    interClusterTravel: [
      { between: ["paris", "orsay"], minutesByMode: { voiture: 35, transports: 70 } },
    ],
    ownedModes: ["voiture", "velo", "transports"],
    schedule: {
      dayStart: "08:00",
      normalEnd: "22:00",
      exceptionalEnd: "23:59",
      maxExceptionalPerWeek: 2,
      maxHoleMinutes: 60,
      lunchBreak: { minMinutes: 30, idealMinutes: 60, window: { start: "12:00", end: "14:00" } },
    },
    work: {
      cours: { hoursPerWeek: 11, placeId: "fac" },
      delos: {
        halfDaysPerWeek: 3,
        placeId: "delos",
        halfDayWindows: [{ start: "09:00", end: "13:00" }],
        presentiel: "prefere",
      },
      monumia: { minHoursPerWeek: 20, maximize: true, maxHoursPerDay: 8, preferredPlaceIds: [] },
    },
    sport: { sessionsPerWeekMin: 3, sessionsPerWeekMax: 4, activities: [] },
    sorties: {
      copine: { name: "Marine", perWeekMin: 2, usualCluster: "orsay" },
      amis: { onRequestOnly: true, usualCluster: "paris" },
    },
    cuisine: {
      budget: "etudiant",
      bigAppetite: true,
      adaptToSport: true,
      dislikedFoods: [],
      lunchAtCrousIfMorningClass: true,
      noMealsAtParents: true,
    },
  });

  it("intra-cluster : forfait du cluster", () => {
    expect(travelMinutes(cfg, "chambre", "fac")?.minutes).toBe(15);
  });

  it("inter-cluster : meilleur mode possédé", () => {
    expect(travelMinutes(cfg, "chambre", "maison")).toEqual({
      minutes: 35,
      mode: "voiture",
    });
  });

  it("vers Delos : la voiture interdite impose les transports", () => {
    expect(travelMinutes(cfg, "chambre", "delos")).toEqual({
      minutes: 70,
      mode: "transports",
    });
  });

  it("même lieu : 0 min", () => {
    expect(travelMinutes(cfg, "delos", "delos")?.minutes).toBe(0);
  });

  it("rejette une config incohérente (lieu vers cluster inconnu)", () => {
    expect(() =>
      parseLifeConfig({
        ...JSON.parse(JSON.stringify(cfgRaw(cfg))),
        places: [
          { id: "x", name: "X", cluster: "inconnu", forbiddenModes: [], sleepable: false },
        ],
      })
    ).toThrow(/cluster inconnu/);
  });
});

/** Re-sérialise une config validée pour la muter dans un test. */
function cfgRaw(c: LifeConfig): unknown {
  return JSON.parse(JSON.stringify(c));
}

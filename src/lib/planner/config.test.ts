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

describe("section solver (v5)", () => {
  it("s'applique entièrement par défauts quand absente du JSON", () => {
    // Le cfg de la fixture travelMinutes ci-dessous n'a pas de section solver.
    const cfg = parseLifeConfig(minimalRaw());
    expect(cfg.solver.candidates).toBe(8);
    expect(cfg.solver.objective.warn).toBe(20);
    expect(cfg.solver.objective.finTardiveApres).toBe("19:00");
    expect(cfg.work.imprevus.defaultHours).toBe(2);
  });

  it("accepte des poids partiels (le reste par défaut)", () => {
    const raw = minimalRaw() as { solver?: unknown };
    raw.solver = { candidates: 3, objective: { jourOff: 50 } };
    const cfg = parseLifeConfig(raw);
    expect(cfg.solver.candidates).toBe(3);
    expect(cfg.solver.objective.jourOff).toBe(50);
    expect(cfg.solver.objective.trouParHeure).toBe(4);
  });

  it("perWeek d'une activité : défaut 1, borné à 7", () => {
    const raw = minimalRaw() as {
      sport: { activities: Record<string, unknown>[] };
    };
    raw.sport.activities = [
      {
        id: "course",
        name: "Course",
        status: "voulu",
        durationMin: 45,
        intensity: "moderate",
        minRestHours: 24,
      },
    ];
    expect(parseLifeConfig(raw).sport.activities[0].perWeek).toBe(1);
    raw.sport.activities[0].perWeek = 8;
    expect(() => parseLifeConfig(raw)).toThrow();
  });
});

/** Config brute minimale valide, à muter dans les tests. */
function minimalRaw(): unknown {
  return {
    version: 1,
    clusters: [
      { id: "orsay", name: "Orsay", intraTravelMin: 15 },
      { id: "paris", name: "Paris", intraTravelMin: 25 },
    ],
    places: [
      { id: "fac", name: "Fac", cluster: "orsay" },
      { id: "bibli", name: "Bibli", cluster: "orsay" },
      { id: "delos", name: "Delos", cluster: "paris", forbiddenModes: ["voiture"] },
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
      lunchBreak: { minMinutes: 30, idealMinutes: 60 },
    },
    work: {
      cours: { hoursPerWeek: 11, placeId: "fac" },
      delos: {
        presentielHalfDaysPerWeek: 3,
        placeId: "delos",
        halfDayWindows: [{ start: "09:00", end: "13:00" }],
        presentiel: "prefere",
      },
      monumia: { minHoursPerWeek: 20, maximize: true, maxHoursPerDay: 8, preferredPlaceIds: [] },
    },
    sport: { sessionsPerWeekMin: 0, sessionsPerWeekMax: 4, activities: [] },
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
  };
}

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
        presentielHalfDaysPerWeek: 3,
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

/**
 * Config de vie FIGÉE pour les tests du planner.
 * Volontairement indépendante de data/life-config.json (que Felix édite
 * librement) : mêmes structures, valeurs stables.
 */

import { parseLifeConfig, type LifeConfig } from "../config";

export const testConfig: LifeConfig = parseLifeConfig({
  version: 1,
  clusters: [
    { id: "orsay", name: "Orsay", intraTravelMin: 15 },
    { id: "paris", name: "Paris", intraTravelMin: 25 },
  ],
  places: [
    { id: "chambre", name: "Chambre", cluster: "orsay", forbiddenModes: [], sleepable: true },
    { id: "fac", name: "Fac", cluster: "orsay", forbiddenModes: [], sleepable: false },
    { id: "bibli", name: "Bibli", cluster: "orsay", forbiddenModes: [], sleepable: false },
    { id: "salle", name: "Salle", cluster: "orsay", forbiddenModes: [], sleepable: false },
    { id: "piscine", name: "Piscine", cluster: "orsay", forbiddenModes: [], sleepable: false },
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
    lunchBreak: { minMinutes: 30, idealMinutes: 60 },
    weekend: { dayStart: "10:00", keepLight: true },
  },
  work: {
    minBlockMinutes: 90,
    cours: { hoursPerWeek: 11, placeId: "fac" },
    delos: {
      halfDaysPerWeek: 3,
      placeId: "delos",
      halfDayWindows: [
        { start: "09:00", end: "13:00" },
        { start: "14:00", end: "18:00" },
      ],
      presentiel: "prefere",
    },
    monumia: {
      minHoursPerWeek: 20,
      maximize: true,
      maxHoursPerDay: 8,
      maxHoursPerWeek: 30,
      preferredPlaceIds: ["bibli"],
    },
  },
  sport: {
    sessionsPerWeekMin: 3,
    sessionsPerWeekMax: 4,
    bufferAfterMin: 15,
    activities: [
      {
        id: "course",
        name: "Course",
        status: "voulu",
        placeIds: [],
        durationMin: 45,
        intensity: "moderate",
        minRestHours: 24,
        morningOk: true,
        fixedSlot: null,
        openingHours: null,
      },
      {
        id: "natation",
        name: "Natation",
        status: "voulu",
        placeIds: ["piscine"],
        durationMin: 60,
        intensity: "high",
        minRestHours: 24,
        morningOk: true,
        fixedSlot: { weekday: "jeudi", start: "18:00", end: "19:00" },
        openingHours: { open: "07:00", close: "20:00" },
      },
      {
        id: "salle",
        name: "Salle",
        status: "voulu",
        placeIds: ["salle"],
        durationMin: 75,
        intensity: "high",
        minRestHours: 48,
        morningOk: false,
        fixedSlot: null,
        openingHours: { open: "08:00", close: "22:00" },
      },
      {
        id: "escalade",
        name: "Escalade",
        status: "optionnel",
        placeIds: [],
        durationMin: 90,
        intensity: "high",
        minRestHours: 24,
        morningOk: false,
        fixedSlot: null,
        openingHours: null,
      },
    ],
  },
  sorties: {
    copine: { name: "Marine", perWeekMin: 2, autoPlace: false, usualCluster: "orsay" },
    amis: { onRequestOnly: true, usualCluster: "paris" },
  },
  cuisine: {
    budget: "etudiant",
    bigAppetite: true,
    adaptToSport: true,
    dislikedFoods: ["courgettes", "chèvre"],
    lunchAtCrousIfMorningClass: true,
    noMealsAtParents: true,
  },
});

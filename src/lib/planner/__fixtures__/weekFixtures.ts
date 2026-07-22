/**
 * Semaine de test partagée : lundi 2026-07-20 → dimanche 2026-07-26,
 * au format de SORTIE de Josiane (day/start/end) + événements fixes.
 * Valide vis-à-vis de testConfig (aucune violation).
 */

import type { FixedItem } from "../types";

export const WEEK = "2026-07-20";

export const fixedCours: FixedItem[] = [
  { id: "c1", title: "Cours", start: "2026-07-21T09:00:00", end: "2026-07-21T12:00:00", placeId: "fac" },
  { id: "c2", title: "Cours", start: "2026-07-24T09:00:00", end: "2026-07-24T12:00:00", placeId: "fac" },
];

export function validJosianeSessions() {
  return [
    { title: "Delos matin", category: "delos", placeId: "delos", day: "2026-07-20", start: "09:00", end: "13:00" },
    { title: "Delos aprem", category: "delos", placeId: "delos", day: "2026-07-20", start: "14:00", end: "18:00" },
    { title: "Monumia", category: "monumia", placeId: "bibli", day: "2026-07-21", start: "14:00", end: "18:00" },
    { title: "Salle", category: "sport", activityId: "salle", placeId: "salle", day: "2026-07-21", start: "18:30", end: "19:45" },
    { title: "Delos matin", category: "delos", placeId: "delos", day: "2026-07-22", start: "09:00", end: "13:00" },
    { title: "Monumia", category: "monumia", placeId: "maison", day: "2026-07-22", start: "14:00", end: "18:00" },
    { title: "Soirée Marine", category: "sortie", day: "2026-07-22", start: "20:00", end: "22:30" },
    { title: "Monumia", category: "monumia", placeId: "bibli", day: "2026-07-23", start: "09:00", end: "12:00" },
    { title: "Monumia", category: "monumia", placeId: "bibli", day: "2026-07-23", start: "13:00", end: "17:30" },
    { title: "Natation", category: "sport", activityId: "natation", placeId: "piscine", day: "2026-07-23", start: "18:00", end: "19:00" },
    { title: "Monumia", category: "monumia", placeId: "bibli", day: "2026-07-24", start: "13:30", end: "18:00" },
    // Samedi : rien avant 10h le week-end.
    { title: "Course", category: "sport", activityId: "course", day: "2026-07-25", start: "10:00", end: "10:45" },
    { title: "Monumia", category: "monumia", placeId: "bibli", day: "2026-07-25", start: "11:00", end: "13:30" },
    { title: "Monumia", category: "monumia", placeId: "bibli", day: "2026-07-25", start: "14:30", end: "16:00" },
    { title: "Sortie Marine", category: "sortie", day: "2026-07-25", start: "20:00", end: "23:00" },
  ];
}

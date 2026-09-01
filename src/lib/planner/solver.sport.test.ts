/**
 * Tests du SPORT (v5.1) sur la CONFIG RÉELLE : creux de midi pour la salle
 * même après un cours du matin, déjeuner juste après, Delos distant (souple)
 * posé ensuite ; heure de pointe évitée.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseLifeConfig } from "./config";
import { WeekInputSchema } from "./contracts";
import { solveWeek } from "./solver";
import type { FixedItem } from "./types";

const realCfg = parseLifeConfig(JSON.parse(readFileSync("data/life-config.json", "utf8")));
const minOf = (iso: string) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
const errorsOf = (vs: { severity: string }[]) => vs.filter((v) => v.severity === "error");

describe("salle au creux de midi un jour de cours (scénario du jeudi 10/09)", () => {
  const days = Array.from({ length: 5 }, (_, i) => `2026-09-${String(7 + i).padStart(2, "0")}`);
  const fixed: FixedItem[] = days.map((d, i) => ({
    id: `stats-${i}`,
    title: "Cours de statistiques",
    start: `${d}T09:00:00`,
    end: `${d}T12:00:00`,
    placeId: "fac-orsay",
  }));
  // Que de la salle cette semaine : elle est forcément posée sur des jours de cours.
  const input = WeekInputSchema.parse({
    weekStart: "2026-09-07",
    sport: { exclure: ["natation", "course"], imposer: [{ activityId: "salle", fois: 1 }] },
  });
  const res = solveWeek(realCfg, { input, fixed });
  const salle = res.sessions.filter((s) => s.activityId === "salle");
  const rush = realCfg.sport.activities.find((a) => a.id === "salle")!.rushHours!;

  it("zéro erreur, la salle est posée", () => {
    expect(errorsOf(res.violations)).toEqual([]);
    expect(salle.length).toBeGreaterThan(0);
  });

  it("cours 9h-12h → salle 12h15 (creux), déjeuner d'une heure juste après, puis le travail (Delos distant / Monumia) après le déjeuner", () => {
    for (const s of salle) {
      const day = s.start.slice(0, 10);
      expect(minOf(s.start), `salle ${s.start}`).toBe(12 * 60 + 15);
      const repas = res.sessions.find((r) => r.category === "repas" && r.start.startsWith(day));
      expect(repas, `déjeuner le ${day}`).toBeDefined();
      expect(minOf(repas!.start)).toBe(minOf(s.end) + realCfg.sport.bufferAfterMin);
      expect(minOf(repas!.end) - minOf(repas!.start)).toBe(realCfg.schedule.lunchBreak.idealMinutes);
      // Rien de « travail » entre le cours et la fin du déjeuner : la séance a
      // bien pris le creux, le Delos distant s'est posé APRÈS (bloc souple).
      const work = res.sessions.filter(
        (w) => w.start.startsWith(day) && ["delos", "monumia", "autre"].includes(w.category)
      );
      for (const w of work) expect(minOf(w.start), `${w.title} ${w.start}`).toBeGreaterThanOrEqual(minOf(repas!.end));
    }
  });

  it("jamais à l'heure de pointe", () => {
    for (const s of salle) {
      const rs = Number(rush.start.slice(0, 2)) * 60 + Number(rush.start.slice(3, 5));
      const re = Number(rush.end.slice(0, 2)) * 60 + Number(rush.end.slice(3, 5));
      expect(Math.max(0, Math.min(minOf(s.end), re) - Math.max(minOf(s.start), rs)), `salle en pointe ${s.start}`).toBe(0);
    }
  });
});

/**
 * Tests de RÉGRESSION adossés à la VRAIE config (data/life-config.json) — à la
 * différence de solver.test.ts (fixture figée), ceux-ci reprennent les semaines
 * réelles où un défaut a été constaté en production, pour qu'il ne revienne pas.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseLifeConfig } from "./config";
import {
  DjimoOutSchema,
  EmilienOutSchema,
  JannikOutSchema,
  WeekInputSchema,
} from "./contracts";
import { solveWeek, type SolverDecisions } from "./solver";

const realCfg = parseLifeConfig(
  JSON.parse(readFileSync("data/life-config.json", "utf8"))
);

const hhmm = (iso: string) => iso.slice(11, 16);
const errorsOf = (violations: { severity: string }[]) =>
  violations.filter((v) => v.severity === "error");

/**
 * Semaine du 2026-07-27 : TP à rendre vendredi, dîner Marine mercredi soir
 * (Orsay), soirée Tristan jeudi soir À PARIS (déclarée withWhom « autre »),
 * cours lundi/mercredi/jeudi à Orsay, journée Delos le mardi (Paris).
 */
function semaineFelix() {
  const briefs = {
    emilien: EmilienOutSchema.parse({
      delos: { halfDays: 2 },
      monumia: { targetHours: 24 },
      imprevus: [{ label: "TP à rendre", hours: 4, deadline: "2026-07-31", priority: "haute" }],
    }),
    jannik: JannikOutSchema.parse({ seances: [] }),
    djimo: DjimoOutSchema.parse({ sorties: [] }),
  };
  const fixed = [
    { id: "c1", title: "Cours", start: "2026-07-27T13:30:00", end: "2026-07-27T17:45:00", placeId: "fac-orsay" },
    { id: "c2", title: "Optimisation", start: "2026-07-29T13:45:00", end: "2026-07-29T17:00:00", placeId: "fac-orsay" },
    { id: "c3", title: "Méthodes non supervisées", start: "2026-07-30T09:00:00", end: "2026-07-30T12:15:00", placeId: "fac-orsay" },
  ];
  const input = WeekInputSchema.parse({
    weekStart: "2026-07-27",
    imprevus: [{ label: "TP à rendre", hoursNeeded: 4, deadline: "2026-07-31" }],
    sortiesDatees: [
      { label: "Dîner avec Marine", withWhom: "marine", day: "2026-07-29", start: "19:00", end: "23:59" },
      { label: "Voir Tristan à Paris", withWhom: "autre", day: "2026-07-30", start: "20:00", end: "23:59" },
    ],
  });
  const decisions: SolverDecisions = {
    // 2 demi-journées de présentiel = une journée Paris complète (le quota est
    // passé de 3 à 2 + 4h à distance posées par le solveur).
    delos: [{ date: "2026-07-28", gabarit: "journee" }],
    sport: [
      { activityId: "course", date: "2026-07-27", moment: "matin" },
      { activityId: "natation", date: "2026-07-29", moment: "matin" },
      { activityId: "salle", date: "2026-07-30", moment: "fin-apres-midi" },
    ],
    sorties: [],
  };
  return solveWeek(realCfg, { input, fixed, ...briefs, decisions });
}

describe("régression — semaine 2026-07-27 (config réelle)", () => {
  it("aucune erreur de guardrail", () => {
    expect(errorsOf(semaineFelix().violations)).toEqual([]);
  });

  it("sortie « autre » localisée dans le libellé → lieu de zone + trajet DANS la journée", () => {
    const res = semaineFelix();
    const tristan = res.sessions.find((s) => s.title.includes("Tristan"));
    // Le libellé « …à Paris » suffit à rattacher la sortie à la zone Paris.
    expect(tristan?.placeId).toBeDefined();
    // Le trajet Orsay → Paris du jeudi a lieu AVANT la soirée, pas à 23h59.
    const trajetJeudi = res.sessions.find(
      (s) =>
        s.category === "trajet" &&
        s.start.startsWith("2026-07-30") &&
        s.title.includes("→ Paris")
    );
    expect(trajetJeudi, "un trajet Orsay → Paris doit exister jeudi").toBeDefined();
    expect(hhmm(trajetJeudi!.end) <= "20:00", `trajet ${trajetJeudi!.start}→${trajetJeudi!.end} : doit arriver avant la sortie de 20:00`).toBe(true);
    // Aucun trajet ne commence à 23h59 ou plus tard.
    for (const t of res.sessions.filter((s) => s.category === "trajet")) {
      expect(hhmm(t.start) < "23:59", `trajet fantôme tardif : ${t.title} @${t.start}`).toBe(true);
    }
  });

  it("le week-end sert de soupape : du Monumia y est posé quand la semaine est dense", () => {
    const res = semaineFelix();
    const weekendMonumia = res.sessions.filter(
      (s) => s.category === "monumia" && s.start.slice(0, 10) >= "2026-08-01"
    );
    expect(
      weekendMonumia.length,
      "avec keepLight=false et une cible de 24h, la soupape week-end doit absorber le reliquat"
    ).toBeGreaterThan(0);
    // Jamais plus de maxHoursPerDay (11h) de Monumia sur une journée.
    const perDay = new Map<string, number>();
    for (const s of res.sessions.filter((s) => s.category === "monumia")) {
      const d = s.start.slice(0, 10);
      const dur = (new Date(s.end).getTime() - new Date(s.start).getTime()) / 60000;
      perDay.set(d, (perDay.get(d) ?? 0) + dur);
    }
    for (const [d, m] of perDay) {
      expect(m, `${d} : ${(m / 60).toFixed(1)}h de Monumia > 11h`).toBeLessThanOrEqual(11 * 60);
    }
  });
});

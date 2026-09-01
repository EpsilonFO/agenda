/**
 * Tests de l'OPTIMISEUR multi-candidats (optimize.ts).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addDays, toLocalIso } from "../dates";
import { testConfig } from "./__fixtures__/testConfig";
import { parseLifeConfig, type LifeConfig } from "./config";
import { WeekInputSchema } from "./contracts";
import { scoreWeekPlan } from "./objective";
import { monumiaTargets, solveWeekBest } from "./optimize";
import { solveWeek } from "./solver";
import type { FixedItem } from "./types";

const realCfg = parseLifeConfig(
  JSON.parse(readFileSync("data/life-config.json", "utf8"))
);

function mondayPlus(k: number): string {
  return toLocalIso(addDays(new Date("2026-07-20T12:00:00"), 7 * k)).slice(0, 10);
}

function coursTueFri(weekStart: string): FixedItem[] {
  const monday = new Date(`${weekStart}T12:00:00`);
  const tue = toLocalIso(addDays(monday, 1)).slice(0, 10);
  const fri = toLocalIso(addDays(monday, 4)).slice(0, 10);
  return [
    { id: "c1", title: "Cours", start: `${tue}T09:00:00`, end: `${tue}T12:00:00`, placeId: "fac" },
    { id: "c2", title: "Cours", start: `${fri}T13:30:00`, end: `${fri}T17:00:00`, placeId: "fac" },
  ];
}

const errorsOf = (vs: { severity: string }[]) => vs.filter((v) => v.severity === "error");

describe("solveWeekBest", () => {
  const WEEK = "2026-07-20";
  const input = WeekInputSchema.parse({ weekStart: WEEK });

  it("est déterministe : deux appels identiques → même plan, même score", () => {
    const a = solveWeekBest(testConfig, { input, fixed: coursTueFri(WEEK) });
    const b = solveWeekBest(testConfig, { input, fixed: coursTueFri(WEEK) });
    expect(a.sessions).toEqual(b.sessions);
    expect(a.score).toEqual(b.score);
    expect(a.candidatesTried).toBe(
      testConfig.solver.candidates * monumiaTargets(testConfig).length
    );
  });

  it("monumiaTargets : grille du plancher (+2h) au plafond, décroissante, ou liste explicite bornée", () => {
    // testConfig : plancher 20, plafond 30, maximize → 22, 24.5, 27.5, 30.
    expect(monumiaTargets(testConfig)).toEqual([30, 27.5, 24.5, 22]);
    const explicit: LifeConfig = structuredClone(testConfig);
    explicit.solver.monumiaTargetsHours = [24, 40, 10];
    expect(monumiaTargets(explicit)).toEqual([30, 24, 22]);
    const noMax: LifeConfig = structuredClone(testConfig);
    noMax.work.monumia.maximize = false;
    expect(monumiaTargets(noMax)).toEqual([22]);
  });

  it("la cible Monumia élue est tracée et le plan respecte plancher/plafond", () => {
    const best = solveWeekBest(testConfig, { input, fixed: coursTueFri(WEEK) });
    expect(monumiaTargets(testConfig)).toContain(best.monumiaTargetHours);
    const h =
      best.sessions
        .filter((s) => s.category === "monumia")
        .reduce((acc, s) => acc + (new Date(s.end).getTime() - new Date(s.start).getTime()), 0) /
      3600000;
    expect(h).toBeGreaterThanOrEqual(testConfig.work.monumia.minHoursPerWeek);
    expect(h).toBeLessThanOrEqual(testConfig.work.monumia.maxHoursPerWeek);
  });

  it("le plan élu score au moins autant que le candidat k=0", () => {
    const best = solveWeekBest(testConfig, { input, fixed: coursTueFri(WEEK) });
    const k0 = solveWeek(testConfig, { input, fixed: coursTueFri(WEEK), seed: `${WEEK}|v5|0` });
    const k0Score = scoreWeekPlan(testConfig, input, k0.sessions, coursTueFri(WEEK), k0.violations);
    expect(best.score.total).toBeGreaterThanOrEqual(k0Score.total);
  });

  it("invariant conservé : zéro erreur de guardrail sur 25 semaines", () => {
    for (let k = 0; k < 25; k++) {
      const ws = mondayPlus(k);
      const res = solveWeekBest(testConfig, {
        input: WeekInputSchema.parse({ weekStart: ws }),
        fixed: coursTueFri(ws),
      });
      const errs = errorsOf(res.violations);
      expect(errs, `semaine ${ws}`).toEqual([]);
    }
  });

  it("candidates=1 et une seule cible : dégénère proprement en un seul solve", () => {
    const cfg1: LifeConfig = structuredClone(testConfig);
    cfg1.solver.candidates = 1;
    cfg1.solver.monumiaTargetsHours = [cfg1.work.monumia.maxHoursPerWeek];
    const best = solveWeekBest(cfg1, { input, fixed: [] });
    const solo = solveWeek(cfg1, { input, fixed: [], seed: `${WEEK}|v5|0` });
    expect(best.sessions).toEqual(solo.sessions);
    expect(best.candidatesTried).toBe(1);
  });

  it("émet le tableau des candidats dans la trace", () => {
    const events: string[] = [];
    solveWeekBest(testConfig, { input, fixed: [] }, {
      onEvent: (agent, kind, content) => events.push(`${agent}/${kind}: ${content}`),
    });
    const table = events.find((e) => e.startsWith("optimiseur/info"));
    expect(table).toBeDefined();
    expect(table).toContain("k=0");
    expect(table).toContain("monumia→");
    expect(table).toMatch(/→ élu : monumia→[\d.]+h k=\d+/);
  });

  it("budget perf : 10 semaines × K candidats en moins de 2 s (config réelle)", () => {
    const t0 = performance.now();
    for (let k = 0; k < 10; k++) {
      const ws = mondayPlus(k);
      solveWeekBest(realCfg, { input: WeekInputSchema.parse({ weekStart: ws }), fixed: [] });
    }
    const elapsed = performance.now() - t0;
    expect(elapsed, `${elapsed.toFixed(0)}ms pour 10 semaines`).toBeLessThan(2000);
  });
});

/**
 * Tests de la fonction OBJECTIF (objective.ts) — pure, déterministe,
 * pilotée par les poids de cfg.solver.objective.
 */

import { describe, expect, it } from "vitest";
import { testConfig } from "./__fixtures__/testConfig";
import { WeekInputSchema } from "./contracts";
import { scoreWeekPlan, formatScore } from "./objective";
import type { LifeConfig } from "./config";
import type { PlanSession } from "./types";

const WEEK = "2026-07-20"; // lundi
const input = WeekInputSchema.parse({ weekStart: WEEK });

let seq = 0;
function session(
  day: string,
  start: string,
  end: string,
  category: PlanSession["category"],
  placeId?: string
): PlanSession {
  seq++;
  return {
    id: `t${seq}`,
    title: category,
    category,
    placeId,
    start: `${day}T${start}:00`,
    end: `${day}T${end}:00`,
  };
}

/** Copie de la config avec des poids surchargés. */
function cfgWith(objective: Partial<LifeConfig["solver"]["objective"]>): LifeConfig {
  const c = structuredClone(testConfig);
  Object.assign(c.solver.objective, objective);
  return c;
}

describe("scoreWeekPlan", () => {
  it("est déterministe (double appel identique)", () => {
    const sessions = [
      session("2026-07-20", "09:00", "13:00", "monumia", "bibli"),
      session("2026-07-20", "14:00", "18:00", "monumia", "bibli"),
    ];
    const a = scoreWeekPlan(testConfig, input, sessions, [], []);
    const b = scoreWeekPlan(testConfig, input, sessions, [], []);
    expect(a).toEqual(b);
  });

  it("un plan troué score moins bien qu'un plan compact (à contenu égal)", () => {
    const compact = [
      session("2026-07-20", "09:00", "12:00", "monumia", "bibli"),
      session("2026-07-20", "12:00", "13:00", "repas"),
      session("2026-07-20", "13:00", "16:00", "monumia", "bibli"),
    ];
    const troue = [
      session("2026-07-20", "09:00", "12:00", "monumia", "bibli"),
      session("2026-07-20", "12:00", "13:00", "repas"),
      session("2026-07-20", "15:00", "18:00", "monumia", "bibli"), // trou de 2h
    ];
    const a = scoreWeekPlan(testConfig, input, compact, [], []);
    const b = scoreWeekPlan(testConfig, input, troue, [], []);
    expect(b.total).toBeLessThan(a.total);
    expect(b.terms.trous).toBeLessThan(0);
  });

  it("le trajet requis entre deux lieux n'est PAS un trou", () => {
    // bibli (orsay) → maison (paris) : 35 min de voiture requis.
    const sessions = [
      session("2026-07-20", "09:00", "15:00", "monumia", "bibli"),
      session("2026-07-20", "15:35", "18:00", "monumia", "maison"),
    ];
    const s = scoreWeekPlan(testConfig, input, sessions, [], []);
    expect(s.terms.trous).toBe(0);
  });

  it("plus de Monumia au-dessus du plancher = meilleur score", () => {
    // 21h vs 24h de Monumia (plancher 20h), en blocs identiques par ailleurs.
    const h21 = [
      session("2026-07-20", "08:00", "15:00", "monumia", "bibli"),
      session("2026-07-21", "08:00", "15:00", "monumia", "bibli"),
      session("2026-07-22", "08:00", "15:00", "monumia", "bibli"),
    ];
    const h24 = [
      session("2026-07-20", "08:00", "16:00", "monumia", "bibli"),
      session("2026-07-21", "08:00", "16:00", "monumia", "bibli"),
      session("2026-07-22", "08:00", "16:00", "monumia", "bibli"),
    ];
    const a = scoreWeekPlan(testConfig, input, h21, [], []);
    const b = scoreWeekPlan(testConfig, input, h24, [], []);
    expect(b.terms.monumia).toBeGreaterThan(a.terms.monumia);
  });

  it("le sport étalé rapporte plus que le sport aggloméré", () => {
    const etale = [
      session("2026-07-20", "18:00", "19:00", "sport"),
      session("2026-07-22", "18:00", "19:00", "sport"),
      session("2026-07-24", "18:00", "19:00", "sport"),
    ];
    const agglomere = [
      session("2026-07-20", "08:00", "09:00", "sport"),
      session("2026-07-21", "18:00", "19:00", "sport"),
      session("2026-07-22", "18:00", "19:00", "sport"),
    ];
    const a = scoreWeekPlan(testConfig, input, etale, [], []);
    const b = scoreWeekPlan(testConfig, input, agglomere, [], []);
    expect(a.terms.sportEtalement).toBeGreaterThan(b.terms.sportEtalement);
  });

  it("compte les jours off (fixes inclus dans le « pas off »)", () => {
    const sessions = [session("2026-07-20", "09:00", "12:00", "monumia", "bibli")];
    const fixed = [
      { id: "c1", title: "Cours", start: "2026-07-21T09:00:00", end: "2026-07-21T12:00:00", placeId: "fac" },
    ];
    const s = scoreWeekPlan(testConfig, input, sessions, fixed, []);
    // 7 jours − lundi (monumia) − mardi (cours) = 5 jours off.
    expect(s.terms.joursOff).toBe(testConfig.solver.objective.jourOff * 5);
  });

  it("pénalise le travail le week-end et les fins tardives", () => {
    const weekend = [session("2026-07-25", "10:00", "14:00", "monumia", "bibli")];
    const sWeekend = scoreWeekPlan(testConfig, input, weekend, [], []);
    expect(sWeekend.terms.weekendTravail).toBeLessThan(0);

    const tardif = [session("2026-07-20", "18:00", "21:00", "monumia", "bibli")];
    const sTardif = scoreWeekPlan(testConfig, input, tardif, [], []);
    // 2h après 19:00.
    expect(sTardif.terms.finsTardives).toBeCloseTo(
      -testConfig.solver.objective.finTardiveParHeure * 2
    );
  });

  it("pénalise le Delos présentiel éclaté sur plus de jours que nécessaire", () => {
    const groupe = [
      session("2026-07-20", "09:00", "13:00", "delos", "delos"),
      session("2026-07-20", "14:00", "18:00", "delos", "delos"),
    ];
    const eclate = [
      session("2026-07-20", "09:00", "13:00", "delos", "delos"),
      session("2026-07-22", "09:00", "13:00", "delos", "delos"),
    ];
    const a = scoreWeekPlan(testConfig, input, groupe, [], []);
    const b = scoreWeekPlan(testConfig, input, eclate, [], []);
    expect(a.terms.delosGroupe).toBe(0);
    expect(b.terms.delosGroupe).toBeLessThan(0);
  });

  it("un poids à 0 éteint son terme", () => {
    const cfg0 = cfgWith({ trouParHeure: 0 });
    const troue = [
      session("2026-07-20", "09:00", "12:00", "monumia", "bibli"),
      session("2026-07-20", "15:00", "18:00", "monumia", "bibli"),
    ];
    const s = scoreWeekPlan(cfg0, input, troue, [], []);
    expect(s.terms.trous).toBe(0);
  });

  it("les violations pèsent : erreur = filet massif, warn = poids config", () => {
    const s = scoreWeekPlan(testConfig, input, [], [], [
      { rule: "big-hole", severity: "warn", message: "", sessionIds: [] },
      { rule: "overlap-internal", severity: "error", message: "", sessionIds: [] },
    ]);
    expect(s.terms.warns).toBe(-testConfig.solver.objective.warn);
    expect(s.terms.erreurs).toBe(-1000);
  });

  it("les sessions trajet n'influent pas sur le score", () => {
    const base = [
      session("2026-07-20", "09:00", "13:00", "delos", "delos"),
      session("2026-07-20", "15:00", "18:00", "monumia", "bibli"),
    ];
    const avecTrajet = [
      ...base,
      session("2026-07-20", "13:00", "14:10", "trajet"),
    ];
    const a = scoreWeekPlan(testConfig, input, base, [], []);
    const b = scoreWeekPlan(testConfig, input, avecTrajet, [], []);
    expect(a).toEqual(b);
  });

  it("formatScore rend les termes non nuls lisibles", () => {
    const txt = formatScore({ total: -12.5, terms: { trous: -12.5, warns: 0 } });
    expect(txt).toContain("total=-12.5");
    expect(txt).toContain("trous=-12.5");
    expect(txt).not.toContain("warns");
  });
});

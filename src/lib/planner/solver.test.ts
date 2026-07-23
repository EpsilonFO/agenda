/**
 * Tests du SOLVEUR déterministe (solver.ts).
 *
 * La garantie centrale : sur de nombreuses semaines et variantes d'entrée, le
 * plan produit ne contient AUCUNE erreur de guardrail (les warns restent
 * tolérés). Puis des scénarios ciblés reprenant un par un les défauts que
 * même GPT 5.6 Terra reproduisait (Delos oublié, déjeuner de 30 min, salle le
 * samedi midi, sortie demandée manquante).
 */

import { describe, expect, it } from "vitest";
import { addDays, toLocalIso } from "../dates";
import { testConfig as cfg } from "./__fixtures__/testConfig";
import {
  DjimoOutSchema,
  EmilienOutSchema,
  JannikOutSchema,
  WeekInputSchema,
} from "./contracts";
import { solveWeek } from "./solver";
import { applyOverrides } from "./josiane";
import type { FixedItem } from "./types";

const briefs = {
  emilien: EmilienOutSchema.parse({
    delos: { halfDays: 3 },
    monumia: { targetHours: 24 },
  }),
  jannik: JannikOutSchema.parse({ seances: [] }),
  djimo: DjimoOutSchema.parse({ sorties: [] }),
};

/** Le k-ième lundi à partir du 2026-07-20 (un lundi). */
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

const errorsOf = (violations: { severity: string; rule: string }[]) =>
  violations.filter((v) => v.severity === "error");

/* ------------------------- Propriété : zéro erreur ------------------------- */

describe("solveWeek — invariant : aucune erreur de guardrail", () => {
  it("semaine libre, sur 25 semaines consécutives", () => {
    for (let k = 0; k < 25; k++) {
      const input = WeekInputSchema.parse({ weekStart: mondayPlus(k) });
      const res = solveWeek(cfg, { input, fixed: [], ...briefs });
      expect(res.attempts).toBe(0);
      const errs = errorsOf(res.violations);
      expect(errs, `semaine ${mondayPlus(k)} : ${errs.map((e) => e.rule).join(", ")}`).toEqual([]);
    }
  });

  it("avec cours mardi + vendredi, sur 25 semaines", () => {
    for (let k = 0; k < 25; k++) {
      const weekStart = mondayPlus(k);
      const input = WeekInputSchema.parse({ weekStart });
      const res = solveWeek(cfg, { input, fixed: coursTueFri(weekStart), ...briefs });
      const errs = errorsOf(res.violations);
      expect(errs, `semaine ${weekStart} : ${errs.map((e) => e.rule).join(", ")}`).toEqual([]);
    }
  });

  it("avec sortie demandée + indispo week-end + voiture indisponible", () => {
    for (let k = 0; k < 10; k++) {
      const weekStart = mondayPlus(k);
      const days = Array.from({ length: 7 }, (_, i) =>
        toLocalIso(addDays(new Date(`${weekStart}T12:00:00`), i)).slice(0, 10)
      );
      const input = WeekInputSchema.parse({
        weekStart,
        voitureDispo: false,
        sortiesDatees: [
          { label: "Soirée Tristan", withWhom: "amis", day: days[3], start: "19:30", end: "23:00" },
        ],
        indisponibilites: [{ day: days[6], reason: "chez les parents" }],
      });
      const res = solveWeek(cfg, { input, fixed: coursTueFri(weekStart), ...briefs });
      const errs = errorsOf(res.violations);
      expect(errs, `semaine ${weekStart} : ${errs.map((e) => e.rule).join(", ")}`).toEqual([]);
    }
  });
});

/* --------------------------- Scénarios ciblés ----------------------------- */

describe("solveWeek — les défauts des runs LLM, rendus impossibles", () => {
  const weekStart = "2026-07-20";
  const input = WeekInputSchema.parse({ weekStart });

  it("les 3 demi-journées Delos sont TOUJOURS posées (jamais oubliées)", () => {
    const res = solveWeek(cfg, { input, fixed: coursTueFri(weekStart), ...briefs });
    const delos = res.sessions.filter((s) => s.category === "delos");
    const totalH = delos.reduce(
      (acc, s) => acc + (new Date(s.end).getTime() - new Date(s.start).getTime()) / 3600000,
      0
    );
    expect(totalH).toBe(12); // 3 × 4h
    expect(res.violations.map((v) => v.rule)).not.toContain("delos-quota");
    // Chaque bloc tombe sur un gabarit exact (9-13 ou 14-18).
    for (const s of delos) {
      const hm = `${s.start.slice(11, 16)}-${s.end.slice(11, 16)}`;
      expect(["09:00-13:00", "14:00-18:00"]).toContain(hm);
    }
  });

  it("un vrai déjeuner (≥ 60 min) est réservé les jours de travail", () => {
    const res = solveWeek(cfg, { input, fixed: coursTueFri(weekStart), ...briefs });
    const lunches = res.sessions.filter((s) => s.category === "repas");
    expect(lunches.length).toBeGreaterThan(0);
    for (const l of lunches) {
      const dur = (new Date(l.end).getTime() - new Date(l.start).getTime()) / 60000;
      expect(dur).toBeGreaterThanOrEqual(cfg.schedule.lunchBreak.minMinutes);
    }
    expect(res.violations.map((v) => v.rule)).not.toContain("lunch-break");
  });

  it("la salle n'est jamais le week-end ni en plein milieu de journée", () => {
    // On force la salle chaque semaine via Jannik.
    const jannik = JannikOutSchema.parse({
      seances: [{ activityId: "salle", title: "Salle" }],
    });
    for (let k = 0; k < 12; k++) {
      const ws = mondayPlus(k);
      const res = solveWeek(cfg, {
        input: WeekInputSchema.parse({ weekStart: ws }),
        fixed: coursTueFri(ws),
        ...briefs,
        jannik,
      });
      const salle = res.sessions.filter((s) => s.activityId === "salle");
      for (const s of salle) {
        const d = new Date(s.start).getDay();
        expect(d, `salle un week-end (${s.start})`).not.toBe(0);
        expect(d, `salle un week-end (${s.start})`).not.toBe(6);
        const startMin = new Date(s.start).getHours() * 60 + new Date(s.start).getMinutes();
        expect(startMin, `salle en milieu de journée (${s.start})`).toBeGreaterThanOrEqual(16 * 60 + 30);
      }
    }
  });

  it("une sortie demandée figure toujours au planning, à l'heure demandée", () => {
    const inp = WeekInputSchema.parse({
      weekStart,
      sortiesDatees: [
        { label: "Soirée avec Tristan", withWhom: "amis", day: "2026-07-23", start: "19:30", end: "23:00" },
      ],
    });
    const res = solveWeek(cfg, { input: inp, fixed: coursTueFri(weekStart), ...briefs });
    const tristan = res.sessions.find((s) => s.title.includes("Tristan"));
    expect(tristan).toBeDefined();
    expect(tristan!.start).toBe("2026-07-23T19:30:00");
    expect(res.violations.map((v) => v.rule)).not.toContain("sortie-manquante");
  });

  it("Monumia respecte plancher et plafond hebdo", () => {
    const res = solveWeek(cfg, { input, fixed: coursTueFri(weekStart), ...briefs });
    const h =
      res.sessions
        .filter((s) => s.category === "monumia")
        .reduce((acc, s) => acc + (new Date(s.end).getTime() - new Date(s.start).getTime()) / 3600000, 0);
    expect(h).toBeGreaterThanOrEqual(cfg.work.monumia.minHoursPerWeek);
    expect(h).toBeLessThanOrEqual(cfg.work.monumia.maxHoursPerWeek);
  });

  it("natation posée sur son créneau imposé (jeudi 18h)", () => {
    const jannik = JannikOutSchema.parse({
      seances: [{ activityId: "natation", title: "Natation" }],
    });
    const res = solveWeek(cfg, { input, fixed: coursTueFri(weekStart), ...briefs, jannik });
    const nat = res.sessions.find((s) => s.activityId === "natation");
    expect(nat).toBeDefined();
    expect(nat!.start.slice(11, 16)).toBe("18:00");
    expect(new Date(nat!.start).getDay()).toBe(4); // jeudi
  });
});

/* ------------------------------ Déterminisme ------------------------------ */

describe("solveWeek — déterminisme", () => {
  it("mêmes entrées → plan identique (reproductible)", () => {
    const input = WeekInputSchema.parse({ weekStart: "2026-09-07" });
    const a = solveWeek(cfg, { input, fixed: coursTueFri("2026-09-07"), ...briefs });
    const b = solveWeek(cfg, { input, fixed: coursTueFri("2026-09-07"), ...briefs });
    expect(a.sessions).toEqual(b.sessions);
  });

  it("semaines différentes → plans qui varient (feature : la variété)", () => {
    const keys = new Set<string>();
    for (let k = 0; k < 8; k++) {
      const ws = mondayPlus(k);
      const res = solveWeek(cfg, { input: WeekInputSchema.parse({ weekStart: ws }), fixed: [], ...briefs });
      // Signature = quels jours de la semaine portent du Delos.
      const sig = res.sessions
        .filter((s) => s.category === "delos")
        .map((s) => new Date(s.start).getDay())
        .sort()
        .join(",");
      keys.add(sig);
    }
    expect(keys.size).toBeGreaterThan(1);
  });
});

/* ----------------------- Overrides (via applyOverrides) ------------------- */

describe("solveWeek — overrides de quota", () => {
  it("sportSessionsMax=2 : au plus 2 séances de sport", () => {
    const input = WeekInputSchema.parse({
      weekStart: "2026-07-20",
      overrides: { sportSessionsMax: 2 },
    });
    // On applique l'override comme le fait placeWeek avant d'appeler le solveur.
    const cfg2 = applyOverrides(cfg, input);
    const res = solveWeek(cfg2, { input, fixed: coursTueFri("2026-07-20"), ...briefs });
    const sport = res.sessions.filter((s) => s.category === "sport");
    expect(sport.length).toBeLessThanOrEqual(2);
    expect(errorsOf(res.violations)).toEqual([]);
  });

  it("Delos n'est PAS surchargeable : toujours 3 demi-journées (règle)", () => {
    // Même si un override Delos était tenté, le schéma l'ignore (clé inconnue).
    const input = WeekInputSchema.parse({
      weekStart: "2026-07-20",
      overrides: { delosHalfDays: 1 } as Record<string, number>,
    });
    const cfg2 = applyOverrides(cfg, input);
    const res = solveWeek(cfg2, { input, fixed: coursTueFri("2026-07-20"), ...briefs });
    const delos = res.sessions.filter((s) => s.category === "delos");
    expect(delos.length).toBe(3);
    expect(errorsOf(res.violations)).toEqual([]);
  });
});

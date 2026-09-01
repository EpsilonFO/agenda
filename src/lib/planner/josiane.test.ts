import { describe, expect, it } from "vitest";
import { testConfig as cfg } from "./__fixtures__/testConfig";
import { WeekInputSchema } from "./contracts";
import {
  applyOperations,
  applyOverrides,
  applyRetouchOps,
  indispoAsFixed,
  placeWeek,
  retouchWeek,
  weekDates,
} from "./josiane";
import { checkWeekPlan } from "./guardrails";
import type { ChatFn } from "./llm";
import type { PlanSession } from "./types";
import { WEEK, fixedCours } from "./__fixtures__/weekFixtures";

function fakeChat(replies: string[]): { chat: ChatFn; calls: () => number } {
  let i = 0;
  return {
    chat: async () => ({ content: replies[Math.min(i++, replies.length - 1)] }),
    calls: () => i,
  };
}

/* ------------------------------ Briques ------------------------------ */

describe("weekDates / overrides / indispos", () => {
  it("weekDates : les 7 jours de la semaine", () => {
    const days = weekDates(WEEK);
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-07-20");
    expect(days[6]).toBe("2026-07-26");
  });

  it("applyOverrides : quotas souples, voiture indisponible, Delos INTOUCHABLE", () => {
    const input = WeekInputSchema.parse({
      weekStart: WEEK,
      voitureDispo: false,
      overrides: { sortiesMarineMin: 1, sportSessionsMax: 2 },
    });
    const c = applyOverrides(cfg, input);
    expect(c.sorties.copine.perWeekMin).toBe(1);
    expect(c.sport.sessionsPerWeekMax).toBe(2);
    expect(c.ownedModes).not.toContain("voiture");
    // Delos reste la règle : 3 demi-journées, jamais surchargées.
    expect(c.work.delos.presentielHalfDaysPerWeek).toBe(cfg.work.delos.presentielHalfDaysPerWeek);
    expect(c.work.delos.presentielHalfDaysPerWeek).toBe(3);
    // La config de base n'est pas mutée.
    expect(cfg.sorties.copine.perWeekMin).toBe(2);
  });

  it("indispoAsFixed : une indispo devient un bloc fixe (chevauchement détecté)", () => {
    const input = WeekInputSchema.parse({
      weekStart: WEEK,
      indisponibilites: [{ day: "2026-07-26", reason: "chez les parents" }],
    });
    const fixed = indispoAsFixed(cfg, input);
    expect(fixed[0].title).toContain("chez les parents");
    const session: PlanSession = {
      id: "x",
      title: "Monumia",
      category: "monumia",
      start: "2026-07-26T10:00:00",
      end: "2026-07-26T12:00:00",
    };
    const rules = checkWeekPlan(cfg, [session], fixed).map((v) => v.rule);
    expect(rules).toContain("overlap-fixed");
  });
});

/* ------------------------------ Placement ----------------------------- */

describe("placeWeek (v5 : pur solveur, zéro LLM)", () => {
  it("planifie sans aucun appel de chat, sans erreur de guardrail", async () => {
    const input = WeekInputSchema.parse({ weekStart: WEEK });
    const res = await placeWeek(cfg, { input, fixed: fixedCours });
    expect(res.attempts).toBe(0); // aucun LLM
    expect(res.violations.filter((v) => v.severity === "error")).toEqual([]);
    expect(res.sessions.length).toBeGreaterThan(0);
  });

  it("applique les overrides et matérialise les indisponibilités", async () => {
    const input = WeekInputSchema.parse({
      weekStart: WEEK,
      overrides: { sportSessionsMax: 2 },
      indisponibilites: [{ day: "2026-07-26", reason: "chez les parents" }],
    });
    const res = await placeWeek(cfg, { input, fixed: fixedCours });
    expect(res.sessions.filter((s) => s.category === "sport").length).toBeLessThanOrEqual(2);
    // Rien ne se pose sur le dimanche indisponible.
    expect(res.sessions.some((s) => s.start.startsWith("2026-07-26"))).toBe(false);
    expect(res.violations.filter((v) => v.severity === "error")).toEqual([]);
  });

  it("est déterministe (mêmes entrées → même plan)", async () => {
    const input = WeekInputSchema.parse({ weekStart: WEEK });
    const a = await placeWeek(cfg, { input, fixed: fixedCours });
    const b = await placeWeek(cfg, { input, fixed: fixedCours });
    expect(a.sessions).toEqual(b.sessions);
  });
});

/* ------------------------------ Retouche ------------------------------ */

describe("retouche", () => {
  const plan: PlanSession[] = [
    { id: "m1", title: "Monumia", category: "monumia", placeId: "bibli", start: "2026-07-20T09:00:00", end: "2026-07-20T12:00:00" },
    { id: "so1", title: "Soirée Marine", category: "sortie", start: "2026-07-24T20:00:00", end: "2026-07-24T23:00:00" },
  ];

  it("applyOperations : move, remove, add", () => {
    const next = applyOperations(plan, [
      { op: "move", sessionId: "m1", day: "2026-07-20", start: "10:00", end: "13:00" },
      { op: "remove", sessionId: "so1" },
      {
        op: "add",
        session: { title: "Course", category: "sport", activityId: "course", placeId: null, day: "2026-07-21", start: "08:00", end: "08:45", exceptional: false, rationale: "" },
      },
    ]);
    expect(next.map((s) => s.title)).toEqual(["Monumia", "Course"]);
    expect(next[0].start).toBe("2026-07-20T10:00:00");
  });

  it("applyRetouchOps (sans LLM) : seules les violations INTRODUITES bloquent", () => {
    // Le plan de base viole des quotas (2 sessions seulement) : une opération
    // propre ne doit rien bloquer pour autant.
    const ok = applyRetouchOps(cfg, {
      sessions: plan,
      fixed: fixedCours,
      operations: [{ op: "move", sessionId: "m1", day: "2026-07-20", start: "10:00", end: "13:00" }],
    });
    expect(ok.blockingErrors).toEqual([]);

    // Déplacer le monumia SUR le cours de mardi introduit un chevauchement.
    const bad = applyRetouchOps(cfg, {
      sessions: plan,
      fixed: fixedCours,
      operations: [{ op: "move", sessionId: "m1", day: "2026-07-21", start: "10:00", end: "13:00" }],
    });
    expect(bad.blockingErrors.length).toBeGreaterThan(0);
  });

  it("retouche simple : les erreurs PRÉEXISTANTES du plan ne bloquent pas", async () => {
    // Le plan de base viole plein de quotas (2 sessions seulement) : une
    // retouche sans rapport ne doit pas déclencher de re-prompt pour autant.
    const { chat, calls } = fakeChat([
      JSON.stringify({
        operations: [{ op: "move", sessionId: "m1", day: "2026-07-20", start: "10:00", end: "13:00" }],
        warnings: [],
      }),
    ]);
    const res = await retouchWeek(
      cfg,
      { weekStart: WEEK, changeNote: "décale mon monumia à 10h", sessions: plan, fixed: fixedCours },
      { chat }
    );
    expect(calls()).toBe(1);
    expect(res.sessions.find((s) => s.id === "m1")?.start).toBe("2026-07-20T10:00:00");
  });

  it("retouche qui introduit un chevauchement : re-prompt puis correction", async () => {
    const { chat, calls } = fakeChat([
      // 1er essai : déplace le monumia SUR le cours de mardi.
      JSON.stringify({
        operations: [{ op: "move", sessionId: "m1", day: "2026-07-21", start: "10:00", end: "13:00" }],
        warnings: [],
      }),
      // 2e essai : créneau propre l'après-midi.
      JSON.stringify({
        operations: [{ op: "move", sessionId: "m1", day: "2026-07-21", start: "14:00", end: "17:00" }],
        warnings: [],
      }),
    ]);
    const res = await retouchWeek(
      cfg,
      { weekStart: WEEK, changeNote: "mets mon monumia mardi", sessions: plan, fixed: fixedCours },
      { chat }
    );
    expect(calls()).toBe(2);
    expect(res.sessions.find((s) => s.id === "m1")?.start).toBe("2026-07-21T14:00:00");
    expect(res.violations.filter((v) => v.rule === "overlap-fixed")).toEqual([]);
  });
});

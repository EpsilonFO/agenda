import { describe, expect, it } from "vitest";
import { testConfig as cfg } from "./__fixtures__/testConfig";
import {
  DjimoOutSchema,
  EmilienOutSchema,
  JannikOutSchema,
  WeekInputSchema,
} from "./contracts";
import {
  applyOperations,
  applyOverrides,
  indispoAsFixed,
  materialize,
  placeWeek,
  retouchWeek,
  weekDates,
} from "./josiane";
import { checkWeekPlan } from "./guardrails";
import { mechanicalRepair } from "./repair";
import type { ChatFn } from "./llm";
import type { PlanSession } from "./types";
import { WEEK, fixedCours, validJosianeSessions } from "./__fixtures__/weekFixtures";

const briefs = {
  emilien: EmilienOutSchema.parse({
    delos: { halfDays: 3 },
    monumia: { targetHours: 24 },
    summary: "",
    messageToJosiane: "3 demi-journées Delos, 24h Monumia.",
  }),
  jannik: JannikOutSchema.parse({ seances: [], summary: "", messageToJosiane: "" }),
  djimo: DjimoOutSchema.parse({ sorties: [], summary: "", messageToJosiane: "" }),
};

function reply(sessions: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ sessions, warnings: [], messages: [], ...extra });
}

function fakeChat(replies: string[]): { chat: ChatFn; calls: () => number } {
  let i = 0;
  return {
    chat: async () => ({ content: replies[Math.min(i++, replies.length - 1)] }),
    calls: () => i,
  };
}

const baseInput = WeekInputSchema.parse({ weekStart: WEEK });

/* ------------------------------ Briques ------------------------------ */

describe("weekDates / materialize / overrides / indispos", () => {
  it("weekDates : les 7 jours de la semaine", () => {
    const days = weekDates(WEEK);
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-07-20");
    expect(days[6]).toBe("2026-07-26");
  });

  it("materialize : ISO local, tri, hors-semaine et durées nulles écartés", () => {
    const out = {
      sessions: [
        { title: "B", category: "monumia" as const, activityId: null, placeId: "bibli", day: "2026-07-21", start: "14:00", end: "16:00", exceptional: false, rationale: "" },
        { title: "Hors semaine", category: "monumia" as const, activityId: null, placeId: null, day: "2026-08-03", start: "09:00", end: "10:00", exceptional: false, rationale: "" },
        { title: "Inversée", category: "monumia" as const, activityId: null, placeId: null, day: "2026-07-21", start: "12:00", end: "11:00", exceptional: false, rationale: "" },
        { title: "A", category: "delos" as const, activityId: null, placeId: "delos", day: "2026-07-20", start: "09:00", end: "13:00", exceptional: false, rationale: "" },
      ],
      warnings: [],
      messages: [],
    };
    const sessions = materialize(out, WEEK);
    expect(sessions.map((s) => s.title)).toEqual(["A", "B"]);
    expect(sessions[0].start).toBe("2026-07-20T09:00:00");
  });

  it("applyOverrides : quotas hebdo et voiture indisponible", () => {
    const input = WeekInputSchema.parse({
      weekStart: WEEK,
      voitureDispo: false,
      overrides: { sortiesMarineMin: 0, delosHalfDays: 2 },
    });
    const c = applyOverrides(cfg, input);
    expect(c.sorties.copine.perWeekMin).toBe(0);
    expect(c.work.delos.halfDaysPerWeek).toBe(2);
    expect(c.ownedModes).not.toContain("voiture");
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

/* ------------------------- Boucle de placement ----------------------- */

describe("placeWeek", () => {
  it("plan valide du premier coup : 1 appel, aucune erreur restante", async () => {
    const { chat, calls } = fakeChat([reply(validJosianeSessions())]);
    const res = await placeWeek(cfg, { input: baseInput, fixed: fixedCours, ...briefs }, { chat });
    expect(calls()).toBe(1);
    expect(res.attempts).toBe(1);
    expect(res.violations.filter((v) => v.severity === "error")).toEqual([]);
    expect(res.sessions.length).toBe(15);
  });

  it("violation de trajet corrigée au re-prompt ciblé", async () => {
    const bad = validJosianeSessions().map((s) =>
      // Mercredi : Monumia à la bibli 25 min après la fin de Delos (Paris) → impossible.
      s.day === "2026-07-22" && s.category === "monumia"
        ? { ...s, placeId: "bibli", start: "13:25", end: "17:25" }
        : s
    );
    const { chat, calls } = fakeChat([reply(bad), reply(validJosianeSessions())]);
    const res = await placeWeek(cfg, { input: baseInput, fixed: fixedCours, ...briefs }, { chat });
    expect(calls()).toBe(2);
    expect(res.attempts).toBe(2);
    expect(res.violations.filter((v) => v.severity === "error")).toEqual([]);
  });

  it("erreur persistante : la réparation mécanique prend le relais", async () => {
    // La salle déborde des heures d'ouverture (21:30-22:45, fermeture 22:00)
    // et le modèle s'obstine sur les 3 appels.
    const stubborn = validJosianeSessions().map((s) =>
      s.title === "Salle" ? { ...s, start: "21:30", end: "22:45" } : s
    );
    const { chat, calls } = fakeChat([reply(stubborn)]);
    const res = await placeWeek(cfg, { input: baseInput, fixed: fixedCours, ...briefs }, { chat });
    expect(calls()).toBe(3); // 1 + 2 re-prompts
    const errors = res.violations.filter((v) => v.severity === "error");
    expect(errors).toEqual([]);
    // La séance a été recalée pour finir à la fermeture (22:00).
    const salle = res.sessions.find((s) => s.title === "Salle")!;
    expect(salle.end).toBe("2026-07-21T22:00:00");
    expect(res.warnings.some((w) => w.includes("recalée"))).toBe(true);
  });

  it("les overrides s'appliquent aux guardrails (Marine absente → 0 sortie exigée)", async () => {
    const noSorties = validJosianeSessions().filter((s) => s.category !== "sortie");
    const input = WeekInputSchema.parse({
      weekStart: WEEK,
      overrides: { sortiesMarineMin: 0 },
    });
    const { chat } = fakeChat([reply(noSorties)]);
    const res = await placeWeek(cfg, { input, fixed: fixedCours, ...briefs }, { chat });
    expect(res.violations.map((v) => v.rule)).not.toContain("sorties-quota");
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

  it("retouche simple : les erreurs PRÉEXISTANTES du plan ne bloquent pas", async () => {
    // Le plan de base viole plein de quotas (2 sessions seulement) : une
    // retouche sans rapport ne doit pas déclencher de re-prompt pour autant.
    const { chat, calls } = fakeChat([
      JSON.stringify({
        operations: [{ op: "move", sessionId: "m1", day: "2026-07-20", start: "10:00", end: "13:00" }],
        warnings: [],
        messages: [],
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
        messages: [],
      }),
      // 2e essai : créneau propre l'après-midi.
      JSON.stringify({
        operations: [{ op: "move", sessionId: "m1", day: "2026-07-21", start: "14:00", end: "17:00" }],
        warnings: [],
        messages: [],
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

/* -------------------------- Réparations pures ------------------------- */

describe("mechanicalRepair", () => {
  it("écourte le travail tardif non exceptionnel, supprime s'il devient trop court", () => {
    const sessions: PlanSession[] = [
      { id: "a", title: "Monumia tard", category: "monumia", start: "2026-07-20T20:00:00", end: "2026-07-20T23:00:00" },
      { id: "b", title: "Monumia mini", category: "monumia", start: "2026-07-21T21:40:00", end: "2026-07-21T22:30:00" },
    ];
    const { sessions: out, log } = mechanicalRepair(cfg, sessions, []);
    expect(out.find((s) => s.id === "a")?.end).toBe("2026-07-20T22:00:00");
    expect(out.find((s) => s.id === "b")).toBeUndefined();
    expect(log).toHaveLength(2);
  });

  it("supprime la session qui chevauche un événement fixe", () => {
    const sessions: PlanSession[] = [
      { id: "a", title: "Monumia", category: "monumia", start: "2026-07-21T10:00:00", end: "2026-07-21T12:30:00" },
    ];
    const { sessions: out } = mechanicalRepair(cfg, sessions, fixedCours);
    expect(out).toEqual([]);
  });
});

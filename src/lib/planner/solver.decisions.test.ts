/**
 * Tests de la COUCHE DÉCISIONS du solveur (solver.ts, v4).
 *
 * Contrat : les choix qualitatifs de Josiane (jours Delos, jour+moment de
 * sport, soir des sorties) sont HONORÉS quand ils sont faisables, REJETÉS avec
 * une raison quand ils ne le sont pas — et dans ce cas le repli seedé garantit
 * quand même un planning légal. Tout se teste sans LLM : les décisions sont de
 * la pure donnée.
 */

import { describe, expect, it } from "vitest";
import { addDays, toLocalIso } from "../dates";
import { testConfig as cfg } from "./__fixtures__/testConfig";
import { WeekInputSchema } from "./contracts";
import { solveWeek, type SolverDecisions } from "./solver";
import type { FixedItem } from "./types";

const WEEK = "2026-07-20"; // un lundi
/** Date (YYYY-MM-DD) du i-ème jour de la semaine (lundi = 0). */
function day(i: number, weekStart = WEEK): string {
  return toLocalIso(addDays(new Date(`${weekStart}T12:00:00`), i)).slice(0, 10);
}

function coursTueFri(weekStart = WEEK): FixedItem[] {
  return [
    { id: "c1", title: "Cours", start: `${day(1, weekStart)}T09:00:00`, end: `${day(1, weekStart)}T12:00:00`, placeId: "fac" },
    { id: "c2", title: "Cours", start: `${day(4, weekStart)}T13:30:00`, end: `${day(4, weekStart)}T17:00:00`, placeId: "fac" },
  ];
}

const errorsOf = (vs: { severity: string }[]) => vs.filter((v) => v.severity === "error");
const delosDaysOf = (sessions: { category: string; start: string }[]) =>
  [...new Set(sessions.filter((s) => s.category === "delos").map((s) => s.start.slice(0, 10)))].sort();

/* --------------------------------- Delos ---------------------------------- */

describe("décisions Delos", () => {
  it("honore les jours choisis (lundi journée + mercredi matin)", () => {
    const decisions: SolverDecisions = {
      delos: [
        { date: day(0), gabarit: "journee" },
        { date: day(2), gabarit: "matin" },
      ],
    };
    const res = solveWeek(cfg, { input: WeekInputSchema.parse({ weekStart: WEEK }), fixed: coursTueFri(), decisions });
    expect(res.rejected).toEqual([]);
    expect(errorsOf(res.violations)).toEqual([]);
    // Delos exactement sur lundi (2 gabarits) et mercredi (matin).
    expect(delosDaysOf(res.sessions)).toEqual([day(0), day(2)]);
    const mon = res.sessions.filter((s) => s.category === "delos" && s.start.startsWith(day(0)));
    expect(mon.map((s) => `${s.start.slice(11, 16)}-${s.end.slice(11, 16)}`).sort()).toEqual(["09:00-13:00", "14:00-18:00"]);
  });

  it("rejette un jour week-end et retombe sur le repli (3 demi-journées quand même)", () => {
    const decisions: SolverDecisions = { delos: [{ date: day(5), gabarit: "journee" }] }; // samedi
    const res = solveWeek(cfg, { input: WeekInputSchema.parse({ weekStart: WEEK }), fixed: coursTueFri(), decisions });
    expect(res.rejected.some((r) => r.kind === "delos" && r.reason.includes("week-end"))).toBe(true);
    const delos = res.sessions.filter((s) => s.category === "delos");
    expect(delos.length).toBe(3); // repli seedé : les 3 demi-journées posées ailleurs
    // Aucune n'est tombée le week-end.
    for (const s of delos) {
      const d = new Date(s.start).getDay();
      expect(d === 0 || d === 6).toBe(false);
    }
    expect(errorsOf(res.violations)).toEqual([]);
  });
});

/* --------------------------------- Sport ---------------------------------- */

describe("décisions Sport", () => {
  // On fixe Delos loin du lundi pour que le lundi reste un jour Orsay libre
  // (sinon le RNG pourrait en faire un jour Paris, rendant la salle inéligible).
  const delosAwayFromMonday: SolverDecisions["delos"] = [
    { date: day(2), gabarit: "journee" },
    { date: day(3), gabarit: "matin" },
  ];

  it("honore jour + moment (salle lundi, fin d'après-midi)", () => {
    const decisions: SolverDecisions = { delos: delosAwayFromMonday, sport: [{ activityId: "salle", date: day(0), moment: "fin-apres-midi" }] };
    const res = solveWeek(cfg, {
      input: WeekInputSchema.parse({ weekStart: WEEK }),
      fixed: coursTueFri(),
      decisions,
    });
    expect(res.rejected).toEqual([]);
    const salle = res.sessions.find((s) => s.activityId === "salle");
    expect(salle).toBeDefined();
    expect(salle!.start.slice(0, 10)).toBe(day(0));
    const startMin = new Date(salle!.start).getHours() * 60 + new Date(salle!.start).getMinutes();
    expect(startMin).toBeGreaterThanOrEqual(16 * 60 + 30);
    expect(errorsOf(res.violations)).toEqual([]);
  });

  it("rejette 'matin' pour la salle (morningOk=false) et replie ailleurs dans la journée", () => {
    const decisions: SolverDecisions = { delos: delosAwayFromMonday, sport: [{ activityId: "salle", date: day(0), moment: "matin" }] };
    const res = solveWeek(cfg, {
      input: WeekInputSchema.parse({ weekStart: WEEK }),
      fixed: coursTueFri(),
      decisions,
    });
    // Comportement choisi : une activité à lieu demandée « matin » n'est PAS
    // rejetée — elle est honorée en FIN DE MATINÉE (créneau creux). Le lundi
    // étant ici un jour libre, elle tombe en milieu de journée, jamais au petit
    // matin (< 10h30).
    const salle = res.sessions.find((s) => s.activityId === "salle");
    expect(salle).toBeDefined();
    const startMin = new Date(salle!.start).getHours() * 60 + new Date(salle!.start).getMinutes();
    expect(startMin).toBeGreaterThanOrEqual(10 * 60 + 30);
    expect(errorsOf(res.violations)).toEqual([]);
  });
});

/* -------------------------------- Sorties --------------------------------- */

describe("décisions Sorties", () => {
  it("place une sortie sans jour sur le soir choisi", () => {
    const input = WeekInputSchema.parse({
      weekStart: WEEK,
      sortiesDatees: [{ label: "Verre avec les amis", withWhom: "amis" }],
    });
    const decisions: SolverDecisions = { sorties: [{ label: "Verre avec les amis", date: day(2) }] };
    const res = solveWeek(cfg, { input, fixed: coursTueFri(), decisions });
    expect(res.rejected).toEqual([]);
    const verre = res.sessions.find((s) => s.title.includes("Verre"));
    expect(verre).toBeDefined();
    expect(verre!.start.slice(0, 10)).toBe(day(2));
    expect(errorsOf(res.violations)).toEqual([]);
  });
});

/* ------------------------------ Déterminisme ------------------------------ */

describe("décisions — déterminisme & invariant", () => {
  it("mêmes décisions + même semaine → plan identique", () => {
    const decisions: SolverDecisions = {
      delos: [{ date: day(0), gabarit: "journee" }, { date: day(2), gabarit: "matin" }],
      sport: [{ activityId: "salle", date: day(0), moment: "fin-apres-midi" }],
    };
    const a = solveWeek(cfg, { input: WeekInputSchema.parse({ weekStart: WEEK }), fixed: coursTueFri(), decisions });
    const b = solveWeek(cfg, { input: WeekInputSchema.parse({ weekStart: WEEK }), fixed: coursTueFri(), decisions });
    expect(a.sessions).toEqual(b.sessions);
  });

  it("des décisions plausibles ne produisent jamais d'erreur (10 semaines)", () => {
    for (let k = 0; k < 10; k++) {
      const ws = toLocalIso(addDays(new Date(`${WEEK}T12:00:00`), 7 * k)).slice(0, 10);
      const decisions: SolverDecisions = {
        // Delos lundi (journée) + mercredi (matin) — jamais les jours de cours.
        delos: [{ date: day(0, ws), gabarit: "journee" }, { date: day(2, ws), gabarit: "matin" }],
        sport: [{ activityId: "salle", date: day(3, ws), moment: "fin-apres-midi" }],
      };
      const res = solveWeek(cfg, { input: WeekInputSchema.parse({ weekStart: ws }), fixed: coursTueFri(ws), decisions });
      expect(errorsOf(res.violations), `semaine ${ws}`).toEqual([]);
    }
  });
});

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
import { WeekInputSchema } from "./contracts";
import { solveWeek, type SolverDecisions } from "./solver";
import { applyOverrides } from "./josiane";
import type { FixedItem } from "./types";

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
      const res = solveWeek(cfg, { input, fixed: [] });
      expect(res.attempts).toBe(0);
      const errs = errorsOf(res.violations);
      expect(errs, `semaine ${mondayPlus(k)} : ${errs.map((e) => e.rule).join(", ")}`).toEqual([]);
    }
  });

  it("avec cours mardi + vendredi, sur 25 semaines", () => {
    for (let k = 0; k < 25; k++) {
      const weekStart = mondayPlus(k);
      const input = WeekInputSchema.parse({ weekStart });
      const res = solveWeek(cfg, { input, fixed: coursTueFri(weekStart) });
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
      const res = solveWeek(cfg, { input, fixed: coursTueFri(weekStart) });
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
    const res = solveWeek(cfg, { input, fixed: coursTueFri(weekStart) });
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
    const res = solveWeek(cfg, { input, fixed: coursTueFri(weekStart) });
    const lunches = res.sessions.filter((s) => s.category === "repas");
    expect(lunches.length).toBeGreaterThan(0);
    for (const l of lunches) {
      const dur = (new Date(l.end).getTime() - new Date(l.start).getTime()) / 60000;
      expect(dur).toBeGreaterThanOrEqual(cfg.schedule.lunchBreak.minMinutes);
    }
    expect(res.violations.map((v) => v.rule)).not.toContain("lunch-break");
  });

  it("la salle : jamais le week-end, jamais à l'heure de pointe, et le creux de midi même après un cours du matin (déjeuner juste après)", () => {
    // On force la salle chaque semaine via la demande hebdo. testConfig : heure de
    // pointe 17h-19h30 ; cours mardi 9h-12h et vendredi 13h30-17h à la fac.
    for (let k = 0; k < 12; k++) {
      const ws = mondayPlus(k);
      const fixed = coursTueFri(ws);
      const res = solveWeek(cfg, {
        input: WeekInputSchema.parse({
          weekStart: ws,
          sport: { imposer: [{ activityId: "salle" }] },
        }),
        fixed,
      });
      expect(errorsOf(res.violations), `semaine ${ws}`).toEqual([]);
      const salle = res.sessions.filter((s) => s.activityId === "salle");
      expect(salle.length, `semaine ${ws} : salle posée`).toBeGreaterThan(0);
      for (const s of salle) {
        const day = s.start.slice(0, 10);
        const wd = new Date(s.start).getDay();
        expect(wd === 0 || wd === 6, `salle un week-end (${s.start})`).toBe(false);
        const startMin = new Date(s.start).getHours() * 60 + new Date(s.start).getMinutes();
        const endMin = new Date(s.end).getHours() * 60 + new Date(s.end).getMinutes();
        // Jamais dans l'heure de pointe quand un creux existe (toujours le cas ici).
        expect(Math.max(0, Math.min(endMin, 19 * 60 + 30) - Math.max(startMin, 17 * 60)), `salle à l'heure de pointe (${s.start})`).toBe(0);
        // Jamais au petit matin (morningOk=false).
        expect(startMin).toBeGreaterThanOrEqual(10 * 60 + 30);
        const morningCours = fixed.find((f) => f.start.startsWith(day) && f.end.slice(11, 16) === "12:00");
        if (morningCours) {
          // Cours 9h-12h : la salle prend le CREUX (dès 12h15, trajet fac → salle),
          // et le déjeuner suit la séance (buffer douche compris).
          expect(startMin, `salle pas au creux après le cours (${s.start})`).toBe(12 * 60 + 15);
          const repas = res.sessions.find((r) => r.category === "repas" && r.start.startsWith(day));
          expect(repas, `pas de déjeuner le ${day}`).toBeDefined();
          const repasStart = new Date(repas!.start).getHours() * 60 + new Date(repas!.start).getMinutes();
          expect(repasStart).toBeGreaterThanOrEqual(endMin + cfg.sport.bufferAfterMin);
        }
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
    const res = solveWeek(cfg, { input: inp, fixed: coursTueFri(weekStart) });
    const tristan = res.sessions.find((s) => s.title.includes("Tristan"));
    expect(tristan).toBeDefined();
    expect(tristan!.start).toBe("2026-07-23T19:30:00");
    expect(res.violations.map((v) => v.rule)).not.toContain("sortie-manquante");
  });

  it("Monumia respecte plancher et plafond hebdo", () => {
    const res = solveWeek(cfg, { input, fixed: coursTueFri(weekStart) });
    const h =
      res.sessions
        .filter((s) => s.category === "monumia")
        .reduce((acc, s) => acc + (new Date(s.end).getTime() - new Date(s.start).getTime()) / 3600000, 0);
    expect(h).toBeGreaterThanOrEqual(cfg.work.monumia.minHoursPerWeek);
    expect(h).toBeLessThanOrEqual(cfg.work.monumia.maxHoursPerWeek);
  });

  it("natation posée sur son créneau imposé (jeudi 18h)", () => {
    const inp = WeekInputSchema.parse({
      weekStart,
      sport: { imposer: [{ activityId: "natation" }] },
    });
    const res = solveWeek(cfg, { input: inp, fixed: coursTueFri(weekStart) });
    const nat = res.sessions.find((s) => s.activityId === "natation");
    expect(nat).toBeDefined();
    expect(nat!.start.slice(11, 16)).toBe("18:00");
    expect(new Date(nat!.start).getDay()).toBe(4); // jeudi
  });
});

/* ----------------------- Rotation sport (config + hebdo) ------------------ */

describe("solveWeek — rotation sport", () => {
  const weekStart = "2026-07-20";

  it("suit perWeek : chaque « voulu » vise son quota (course/natation/salle × 1)", () => {
    const res = solveWeek(cfg, {
      input: WeekInputSchema.parse({ weekStart }),
      fixed: [],
    });
    const byAct = new Map<string, number>();
    for (const s of res.sessions.filter((s) => s.category === "sport")) {
      byAct.set(s.activityId!, (byAct.get(s.activityId!) ?? 0) + 1);
    }
    // 3 activités voulues × perWeek 1 = 3 séances, dans le quota [3, 4].
    expect([...byAct.values()].reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(
      cfg.sport.sessionsPerWeekMin
    );
    for (const [id, n] of byAct) {
      expect(n, `${id} posé ${n} fois`).toBeLessThanOrEqual(2);
    }
  });

  it("exclure retire une activité de la semaine", () => {
    const res = solveWeek(cfg, {
      input: WeekInputSchema.parse({ weekStart, sport: { exclure: ["natation"] } }),
      fixed: [],
    });
    expect(res.sessions.some((s) => s.activityId === "natation")).toBe(false);
    expect(errorsOf(res.violations)).toEqual([]);
  });

  it("une activité « optionnel » ne se place QUE via imposer", () => {
    const sans = solveWeek(cfg, { input: WeekInputSchema.parse({ weekStart }), fixed: [] });
    expect(sans.sessions.some((s) => s.activityId === "escalade")).toBe(false);

    const avec = solveWeek(cfg, {
      input: WeekInputSchema.parse({
        weekStart,
        sport: { imposer: [{ activityId: "escalade" }] },
      }),
      fixed: [],
    });
    expect(avec.sessions.some((s) => s.activityId === "escalade")).toBe(true);
    expect(errorsOf(avec.violations)).toEqual([]);
  });

  it("imposer surcharge perWeek pour une « voulu » (2 courses)", () => {
    const res = solveWeek(cfg, {
      input: WeekInputSchema.parse({
        weekStart,
        sport: { imposer: [{ activityId: "course", fois: 2 }] },
      }),
      fixed: [],
    });
    const courses = res.sessions.filter((s) => s.activityId === "course");
    expect(courses.length).toBe(2);
    expect(errorsOf(res.violations)).toEqual([]);
  });

  it("un activityId inconnu est ignoré avec un warning, sans erreur", () => {
    const res = solveWeek(cfg, {
      input: WeekInputSchema.parse({
        weekStart,
        sport: { exclure: ["yoga"], imposer: [{ activityId: "crossfit" }] },
      }),
      fixed: [],
    });
    expect(res.warnings.some((w) => w.includes("yoga"))).toBe(true);
    expect(res.warnings.some((w) => w.includes("crossfit"))).toBe(true);
    expect(errorsOf(res.violations)).toEqual([]);
  });
});

/* ------------------------------ Déterminisme ------------------------------ */

describe("solveWeek — déterminisme", () => {
  it("mêmes entrées → plan identique (reproductible)", () => {
    const input = WeekInputSchema.parse({ weekStart: "2026-09-07" });
    const a = solveWeek(cfg, { input, fixed: coursTueFri("2026-09-07") });
    const b = solveWeek(cfg, { input, fixed: coursTueFri("2026-09-07") });
    expect(a.sessions).toEqual(b.sessions);
  });

  it("seeds différents sur la MÊME semaine → plans qui peuvent différer", () => {
    const input = WeekInputSchema.parse({ weekStart: "2026-09-07" });
    const keys = new Set<string>();
    for (let k = 0; k < 8; k++) {
      const res = solveWeek(cfg, { input, fixed: [], seed: `2026-09-07|v5|${k}` });
      const sig = res.sessions
        .filter((s) => s.category === "delos")
        .map((s) => new Date(s.start).getDay())
        .sort()
        .join(",");
      keys.add(sig);
    }
    expect(keys.size).toBeGreaterThan(1);
  });

  it("semaines différentes → plans qui varient (feature : la variété)", () => {
    const keys = new Set<string>();
    for (let k = 0; k < 8; k++) {
      const ws = mondayPlus(k);
      const res = solveWeek(cfg, { input: WeekInputSchema.parse({ weekStart: ws }), fixed: [] });
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

/* --------------------- Transitions & temps morts ------------------------- */

describe("solveWeek — transitions & temps morts", () => {
  const buffer = cfg.sport.bufferAfterMin;

  it("laisse le buffer après TOUTE séance de sport, course (sans lieu) comprise", () => {
    for (let k = 0; k < 12; k++) {
      const ws = mondayPlus(k);
      const res = solveWeek(cfg, {
        input: WeekInputSchema.parse({
          weekStart: ws,
          sport: { imposer: [{ activityId: "course" }] },
        }),
        fixed: coursTueFri(ws),
      });
      for (const sp of res.sessions.filter((s) => s.category === "sport")) {
        const spEnd = new Date(sp.end).getTime();
        const day = sp.start.slice(0, 10);
        for (const o of res.sessions) {
          if (o === sp || o.category === "trajet" || o.start.slice(0, 10) !== day) continue;
          const gapMin = (new Date(o.start).getTime() - spEnd) / 60000;
          if (gapMin >= 0) {
            expect(gapMin, `« ${o.title} » ${gapMin}min après « ${sp.title} » (${ws})`).toBeGreaterThanOrEqual(buffer);
          }
        }
      }
      expect(errorsOf(res.violations)).toEqual([]);
    }
  });

  it("une sortie reçoit le cluster de son entourage → trajet exigé (amis = Paris)", () => {
    const input = WeekInputSchema.parse({
      weekStart: "2026-07-20",
      sortiesDatees: [{ label: "Dîner Tristan", withWhom: "amis", day: "2026-07-23", start: "20:00", end: "23:00" }],
    });
    const res = solveWeek(cfg, { input, fixed: coursTueFri("2026-07-20") });
    const sortie = res.sessions.find((s) => s.title.includes("Tristan"));
    expect(sortie?.placeId).toBeDefined();
    expect(cfg.places.find((p) => p.id === sortie!.placeId)?.cluster).toBe("paris");
    expect(errorsOf(res.violations)).toEqual([]);
  });

  it("le déjeuner se colle au cours de l'après-midi (pas de trou avant)", () => {
    // Vendredi : cours 13:30-17 → le déjeuner doit finir pile à 13:30.
    const res = solveWeek(cfg, {
      input: WeekInputSchema.parse({ weekStart: "2026-07-20" }),
      fixed: coursTueFri("2026-07-20"),
    });
    const lunch = res.sessions.find((s) => s.category === "repas" && s.start.startsWith("2026-07-24"));
    expect(lunch).toBeDefined();
    expect(lunch!.end.slice(11, 16)).toBe("13:30");
  });

  it("génère un événement de trajet inter-zones, sans chevauchement", () => {
    const input = WeekInputSchema.parse({
      weekStart: "2026-07-20",
      sortiesDatees: [{ label: "Soirée Marine", withWhom: "marine", day: "2026-07-20", start: "20:00", end: "23:00" }],
    });
    const decisions: SolverDecisions = {
      delos: [{ date: "2026-07-20", gabarit: "journee" }, { date: "2026-07-22", gabarit: "matin" }],
    };
    const res = solveWeek(cfg, { input, fixed: coursTueFri("2026-07-20"), decisions });
    const trajets = res.sessions.filter((s) => s.category === "trajet");
    expect(trajets.length).toBeGreaterThan(0);
    for (const tr of trajets) {
      expect(tr.title).toContain("→");
      for (const o of res.sessions) {
        if (o === tr) continue;
        const overlap = tr.start < o.end && o.start < tr.end;
        expect(overlap, `« ${tr.title} » chevauche « ${o.title} »`).toBe(false);
      }
    }
    expect(errorsOf(res.violations)).toEqual([]);
  });

  it("place le trajet inter-zones la VEILLE au soir quand le lendemain matin est dans une autre zone", () => {
    // Scénario réel : mardi = journée Delos (Paris), mercredi = Monumia (Orsay)
    // dès 8h. Le trajet Paris → Orsay doit être posé mardi soir, pas mercredi 8h.
    const input = WeekInputSchema.parse({ weekStart: "2026-07-20" });
    const decisions: SolverDecisions = {
      delos: [{ date: "2026-07-21", gabarit: "journee" }], // mardi, Paris
    };
    const res = solveWeek(cfg, { input, fixed: [], decisions });

    const trajets = res.sessions.filter((s) => s.category === "trajet");
    // Il doit exister un trajet Paris → Orsay placé le mardi (veille du mercredi).
    const veille = trajets.find(
      (t) => t.title.includes("Paris → Orsay") && t.start.startsWith("2026-07-21")
    );
    expect(veille, `trajets générés : ${trajets.map((t) => `${t.title} @${t.start}`).join(" | ")}`).toBeDefined();
    // ... et il commence APRÈS la fin du dernier bloc du mardi.
    const lastTuesday = res.sessions
      .filter((s) => s.start.startsWith("2026-07-21") && s.category !== "trajet")
      .sort((a, b) => a.end.localeCompare(b.end))
      .pop();
    expect(veille!.start >= lastTuesday!.end).toBe(true);
    expect(errorsOf(res.violations)).toEqual([]);
  });
});

describe("solveWeek — overrides de quota", () => {
  it("sportSessionsMax=2 : au plus 2 séances de sport", () => {
    const input = WeekInputSchema.parse({
      weekStart: "2026-07-20",
      overrides: { sportSessionsMax: 2 },
    });
    // On applique l'override comme le fait placeWeek avant d'appeler le solveur.
    const cfg2 = applyOverrides(cfg, input);
    const res = solveWeek(cfg2, { input, fixed: coursTueFri("2026-07-20") });
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
    const res = solveWeek(cfg2, { input, fixed: coursTueFri("2026-07-20") });
    const delos = res.sessions.filter((s) => s.category === "delos");
    expect(delos.length).toBe(3);
    expect(errorsOf(res.violations)).toEqual([]);
  });
});

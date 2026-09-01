/**
 * Tests de RÉGRESSION adossés à la VRAIE config (data/life-config.json) — à la
 * différence de solver.test.ts (fixture figée), ceux-ci reprennent les semaines
 * réelles où un défaut a été constaté en production, pour qu'il ne revienne pas.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseLifeConfig } from "./config";
import { WeekInputSchema } from "./contracts";
import { solveWeekBest } from "./optimize";
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
  return solveWeek(realCfg, { input, fixed, decisions });
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
      "avec keepLight=false et maximize, la soupape week-end doit absorber le reliquat"
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

/**
 * Semaine du 2026-09-07 (run raté du 01/09) : cours de statistiques TOUS les
 * matins 9h-12h + Rentrée vendredi après-midi, dîner Gazoduc lundi soir,
 * natation + course + salle demandées. Défauts constatés : 0/2 demi-journées
 * Delos (le repli n'acceptait que les jours vierges), déjeuners de 30 min,
 * trou fantôme après la natation (double crédit déjeuner), 2 sports le même
 * jour (tri des jours cassé + objectif qui récompensait l'empilement),
 * semaine dense sans soupape week-end.
 */
describe("régression — semaine 2026-09-07 (cours tous les matins, config réelle)", () => {
  const days = Array.from({ length: 7 }, (_, i) => `2026-09-${String(7 + i).padStart(2, "0")}`);
  const fixed = [
    ...days.slice(0, 5).map((d, i) => ({
      id: `stats-${i}`,
      title: "Cours de statistiques",
      start: `${d}T09:00:00`,
      end: `${d}T12:00:00`,
      placeId: "fac-orsay",
    })),
    {
      id: "rentree",
      title: "Rentrée",
      start: "2026-09-11T14:00:00",
      end: "2026-09-11T15:30:00",
      placeId: "fac-orsay",
    },
  ];
  const input = WeekInputSchema.parse({
    weekStart: "2026-09-07",
    sortiesDatees: [
      { label: "Manger avec Gazoduc", withWhom: "amis", day: "2026-09-07", start: "20:00", end: "23:59" },
    ],
    sport: {
      imposer: [
        { activityId: "natation" },
        { activityId: "course" },
        { activityId: "salle" },
      ],
    },
  });
  const res = solveWeekBest(realCfg, { input, fixed });
  const minutes = (s: { start: string; end: string }) =>
    (new Date(s.end).getTime() - new Date(s.start).getTime()) / 60000;

  it("aucune erreur de guardrail", () => {
    expect(errorsOf(res.violations)).toEqual([]);
  });

  it("les 12h de Delos sont posées MALGRÉ les matins pris (gabarits après-midi)", () => {
    const delos = res.sessions.filter((s) => s.category === "delos");
    const total = delos.reduce((a, s) => a + minutes(s), 0);
    expect(total).toBe(12 * 60);
    // Le présentiel tombe sur des gabarits EXACTS, en semaine.
    const presentiel = delos.filter((s) => s.placeId === "delos");
    expect(presentiel).toHaveLength(2);
    for (const s of presentiel) {
      expect(["09:00-13:00", "14:00-18:00"]).toContain(
        `${s.start.slice(11, 16)}-${s.end.slice(11, 16)}`
      );
      const wd = new Date(s.start).getDay();
      expect(wd === 0 || wd === 6, `présentiel un week-end (${s.start})`).toBe(false);
    }
  });

  it("jamais deux sports le même jour quand d'autres jours sont libres", () => {
    const perDay = new Map<string, number>();
    for (const s of res.sessions.filter((s) => s.category === "sport")) {
      const d = s.start.slice(0, 10);
      perDay.set(d, (perDay.get(d) ?? 0) + 1);
    }
    expect(res.sessions.filter((s) => s.category === "sport").length).toBe(3);
    for (const [d, n] of perDay) {
      expect(n, `${n} sports le ${d}`).toBeLessThanOrEqual(1);
    }
  });

  it("les déjeuners font l'heure idéale, sauf quand un trajet inter-zones suit (raccourci, jamais sous le minimum)", () => {
    const repas = res.sessions.filter((s) => s.category === "repas");
    expect(repas.length).toBeGreaterThan(0);
    const trajets = res.sessions.filter((s) => s.category === "trajet");
    for (const r of repas) {
      expect(minutes(r), `déjeuner sous le minimum le ${r.start}`).toBeGreaterThanOrEqual(
        realCfg.schedule.lunchBreak.minMinutes
      );
      // Un trajet qui part dans les 30 min après le repas justifie un déjeuner
      // plus court (cours Orsay 12h → RER → Delos 14h) ; sinon : l'heure idéale.
      const rEnd = new Date(r.end).getTime();
      const tripFollows = trajets.some((t) => {
        const tStart = new Date(t.start).getTime();
        return tStart >= rEnd && tStart - rEnd <= 30 * 60000;
      });
      if (!tripFollows) {
        expect(minutes(r), `déjeuner court sans trajet le ${r.start}`).toBeGreaterThanOrEqual(
          realCfg.schedule.lunchBreak.idealMinutes
        );
      }
    }
  });

  it("pas de trou fantôme : plus de double crédit déjeuner dans une journée", () => {
    // Sur chaque jour, le battement entre deux blocs consécutifs (sessions ET
    // événements fixes, hors trajets et sorties) reste raisonnable. Le bug des
    // 60 min imposées après le sport (déjeuner déjà pris) ne repasse pas.
    const byDay = new Map<string, { start: number; end: number }[]>();
    const push = (d: string, start: string, end: string) => {
      const list = byDay.get(d) ?? [];
      list.push({
        start: new Date(start).getTime() / 60000,
        end: new Date(end).getTime() / 60000,
      });
      byDay.set(d, list);
    };
    for (const s of res.sessions) {
      if (s.category === "trajet" || s.category === "sortie") continue;
      push(s.start.slice(0, 10), s.start, s.end);
    }
    for (const f of fixed) push(f.start.slice(0, 10), f.start, f.end);
    for (const [d, list] of byDay) {
      const sorted = list.sort((a, b) => a.start - b.start);
      for (let i = 0; i + 1 < sorted.length; i++) {
        const gap = sorted[i + 1].start - sorted[i].end;
        // 70 min de trajet inter-zones + 15 douche = pire cas légitime.
        expect(gap, `trou de ${gap} min le ${d}`).toBeLessThanOrEqual(90);
      }
    }
  });

  it("la semaine dense déborde sur le week-end plutôt que d'empiler 8h/jour", () => {
    const comfort = realCfg.work.monumia.weekdayComfortHoursPerDay * 60;
    const perDay = new Map<string, number>();
    for (const s of res.sessions.filter((s) => s.category === "monumia")) {
      const d = s.start.slice(0, 10);
      perDay.set(d, (perDay.get(d) ?? 0) + minutes(s));
    }
    const weekendTotal = (perDay.get(days[5]) ?? 0) + (perDay.get(days[6]) ?? 0);
    for (const [d, m] of perDay) {
      const wd = new Date(`${d}T12:00:00`).getDay();
      if (wd === 0 || wd === 6) continue;
      // Un jour de semaine ne dépasse le confort QUE si la soupape week-end
      // est déjà pleine (2 × weekendMaxHoursPerDay).
      if (m > comfort) {
        expect(
          weekendTotal,
          `${(m / 60).toFixed(1)}h de Monumia le ${d} alors que le week-end n'est pas plein`
        ).toBeGreaterThanOrEqual(2 * realCfg.work.monumia.weekendMaxHoursPerDay * 60);
      }
    }
  });

  it("le dîner Gazoduc est posé lundi 20h, tel que demandé", () => {
    const gazoduc = res.sessions.find((s) => s.title.includes("Gazoduc"));
    expect(gazoduc).toBeDefined();
    expect(gazoduc!.start).toBe("2026-09-07T20:00:00");
  });
});

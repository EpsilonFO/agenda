/**
 * Tests des TRAJETS (v5.1) : déjeuner localisé, chaîne des trajets à travers
 * les blocs sans lieu, trajet de la veille toujours présent (soirée écourtée),
 * voiture suivie (elle reste là où on l'a laissée), zone explicite d'une sortie.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { testConfig as cfg } from "./__fixtures__/testConfig";
import { parseLifeConfig } from "./config";
import { WeekInputSchema } from "./contracts";
import { checkWeekPlan } from "./guardrails";
import { solveWeekBest } from "./optimize";
import { solveWeek, type SolverDecisions } from "./solver";
import type { FixedItem, PlanSession } from "./types";

const WEEK = "2026-07-20"; // lundi
const errorsOf = (vs: { severity: string }[]) => vs.filter((v) => v.severity === "error");
const hhmm = (iso: string) => iso.slice(11, 16);
const cours = (day: string, start = "09:00", end = "12:00"): FixedItem => ({
  id: `c-${day}`,
  title: "Cours",
  start: `${day}T${start}:00`,
  end: `${day}T${end}:00`,
  placeId: "fac",
});

describe("déjeuner localisé et trajet de midi", () => {
  it("cours à Orsay le matin, Delos à Paris l'après-midi : le déjeuner est sur place, raccourci pour le RER, et le trajet s'affiche", () => {
    const input = WeekInputSchema.parse({ weekStart: WEEK });
    const decisions: SolverDecisions = {
      delos: [{ date: "2026-07-20", gabarit: "apres-midi" }, { date: "2026-07-22", gabarit: "journee" }],
    };
    const res = solveWeek(cfg, { input, fixed: [cours("2026-07-20")], decisions });
    expect(errorsOf(res.violations)).toEqual([]);

    const lundi = res.sessions.filter((s) => s.start.startsWith("2026-07-20"));
    const delos = lundi.find((s) => s.category === "delos");
    expect(delos && hhmm(delos.start)).toBe("14:00");
    const repas = lundi.find((s) => s.category === "repas");
    expect(repas, "un déjeuner lundi").toBeDefined();
    // On mange en sortant du cours, à la fac…
    expect(repas!.placeId).toBe("fac");
    expect(hhmm(repas!.start)).toBe("12:00");
    // …et on garde les 70 min de RER (voiture interdite à Delos) : fin ≤ 12:50.
    expect(hhmm(repas!.end) <= "12:50", `déjeuner ${repas!.start}→${repas!.end}`).toBe(true);
    // Le trajet Orsay → Paris est matérialisé à midi, en transports, arrivée 14:00.
    const trajet = lundi.find((s) => s.category === "trajet" && s.title.includes("Orsay → Paris"));
    expect(trajet, "trajet de midi").toBeDefined();
    expect(trajet!.title).toContain("transports");
    expect(hhmm(trajet!.end)).toBe("14:00");
    expect(trajet!.start >= repas!.end).toBe(true);
  });

  it("un déjeuner sans lieu ne cache plus un trajet impossible (guardrail miroir)", () => {
    const fixed = [cours("2026-07-20")];
    const monumia: PlanSession = {
      id: "m",
      title: "Monumia",
      category: "monumia",
      placeId: "maison",
      start: "2026-07-20T13:30:00",
      end: "2026-07-20T17:00:00",
    };
    const repas: PlanSession = {
      id: "r",
      title: "Déjeuner",
      category: "repas",
      start: "2026-07-20T12:00:00",
      end: "2026-07-20T13:00:00",
    };
    // Sans repas : 90 min entre la fac et Paris (35 min voiture + 30 déjeuner) → ok.
    const sans = checkWeekPlan(cfg, [monumia], fixed).filter((v) => v.rule === "travel-time");
    expect(sans).toEqual([]);
    // Avec un repas SANS lieu qui occupe 60 des 90 min : il ne reste que 30 min
    // pour 35 min de route → erreur, mesurée depuis le cours (à travers le repas).
    const avec = checkWeekPlan(cfg, [monumia, repas], fixed).filter((v) => v.rule === "travel-time");
    expect(avec.length).toBe(1);
    expect(avec[0].message).toContain("blocs sans lieu intercalés");
  });
});

describe("trajet de la veille", () => {
  it("existe TOUJOURS : une soirée jusqu'à 23h59 est écourtée du temps de trajet", () => {
    const input = WeekInputSchema.parse({
      weekStart: WEEK,
      sortiesDatees: [
        { label: "Soirée à Paris", withWhom: "autre", zone: "paris", day: "2026-07-20", start: "20:00", end: "23:59" },
      ],
    });
    const decisions: SolverDecisions = { delos: [{ date: "2026-07-20", gabarit: "journee" }] };
    const res = solveWeek(cfg, { input, fixed: [cours("2026-07-21")], decisions });
    expect(errorsOf(res.violations)).toEqual([]);

    const veille = res.sessions.find(
      (s) => s.category === "trajet" && s.title.includes("veille") && s.start.startsWith("2026-07-20")
    );
    expect(veille, "trajet de veille lundi soir").toBeDefined();
    expect(veille!.end <= "2026-07-21T00:00:00").toBe(true);
    const soiree = res.sessions.find((s) => s.category === "sortie");
    expect(soiree!.end).toBe(veille!.start);
    expect(hhmm(soiree!.end) < "23:59").toBe(true);
    expect(soiree!.rationale).toContain("Écourtée");
    // La sortie porte la zone demandée (lieu représentatif de Paris).
    expect(soiree!.placeId).toBe("maison");
  });

  it("aucun trajet ne part après minuit ni ne chevauche une session", () => {
    const input = WeekInputSchema.parse({
      weekStart: WEEK,
      sortiesDatees: [{ label: "Dîner", withWhom: "amis", day: "2026-07-22", start: "20:00", end: "23:59" }],
    });
    const res = solveWeek(cfg, { input, fixed: [cours("2026-07-21"), cours("2026-07-23")] });
    for (const t of res.sessions.filter((s) => s.category === "trajet")) {
      expect(hhmm(t.start) < "23:59", `départ impossible : ${t.title} @${t.start}`).toBe(true);
      for (const o of res.sessions) {
        if (o === t || o.category === "trajet") continue;
        expect(t.start < o.end && o.start < t.end, `« ${t.title} » chevauche « ${o.title} »`).toBe(false);
      }
    }
  });
});

describe("la voiture reste là où on l'a laissée", () => {
  it("aller à Delos en RER depuis Orsay → retour du soir en RER (70 min), pas en voiture", () => {
    const input = WeekInputSchema.parse({ weekStart: WEEK });
    const decisions: SolverDecisions = {
      delos: [{ date: "2026-07-20", gabarit: "apres-midi" }, { date: "2026-07-22", gabarit: "journee" }],
    };
    const res = solveWeek(cfg, {
      input,
      fixed: [cours("2026-07-20"), cours("2026-07-21")],
      decisions,
    });
    const retour = res.sessions.find(
      (s) => s.category === "trajet" && s.start.startsWith("2026-07-20") && s.title.includes("Paris → Orsay")
    );
    expect(retour, "retour lundi soir").toBeDefined();
    expect(retour!.title).toContain("transports");
    expect(retour!.title).toContain("70 min");
  });

  it("aller à Paris en voiture la veille → la voiture est à Paris, le retour se fait en voiture", () => {
    const input = WeekInputSchema.parse({ weekStart: WEEK });
    const decisions: SolverDecisions = {
      delos: [{ date: "2026-07-21", gabarit: "journee" }, { date: "2026-07-23", gabarit: "matin" }],
    };
    const res = solveWeek(cfg, { input, fixed: [cours("2026-07-20"), cours("2026-07-22")], decisions });
    const aller = res.sessions.find(
      (s) => s.category === "trajet" && s.start.startsWith("2026-07-20") && s.title.includes("Orsay → Paris")
    );
    expect(aller, "aller lundi soir").toBeDefined();
    // Destination = la base de la zone (on dort chez les parents, pas à Delos) → voiture possible.
    expect(aller!.title).toContain("voiture");
    const retour = res.sessions.find(
      (s) => s.category === "trajet" && s.start.startsWith("2026-07-21") && s.title.includes("Paris → Orsay")
    );
    expect(retour, "retour mardi soir").toBeDefined();
    // Depuis Delos (voiture interdite) on récupère la voiture à la base : voiture, saut intra-zone compris.
    expect(retour!.title).toContain("voiture");
    expect(retour!.title).toContain(`${35 + 25} min`);
  });
});

describe("semaine réelle 2026-09-07 (config réelle, optimiseur complet)", () => {
  const realCfg = parseLifeConfig(JSON.parse(readFileSync("data/life-config.json", "utf8")));
  const days = Array.from({ length: 7 }, (_, i) => `2026-09-${String(7 + i).padStart(2, "0")}`);
  const fixed: FixedItem[] = [
    ...days.slice(0, 5).map((d, i) => ({
      id: `stats-${i}`,
      title: "Cours de statistiques",
      start: `${d}T09:00:00`,
      end: `${d}T12:00:00`,
      placeId: "fac-orsay",
    })),
    { id: "rentree", title: "Rentrée", start: "2026-09-11T14:00:00", end: "2026-09-11T15:30:00", placeId: "fac-orsay" },
  ];
  const input = WeekInputSchema.parse({
    weekStart: "2026-09-07",
    sortiesDatees: [{ label: "Manger avec Gazoduc", withWhom: "autre", day: "2026-09-07", start: "20:00", end: "23:59" }],
  });
  const res = solveWeekBest(realCfg, { input, fixed });

  it("zéro erreur, et chaque après-midi Delos après un cours a son trajet de midi ET son retour de veille", () => {
    expect(errorsOf(res.violations)).toEqual([]);
    const presentiel = res.sessions.filter((s) => s.category === "delos" && s.placeId === "delos");
    expect(presentiel.length).toBe(2);
    for (const d of presentiel) {
      const day = d.start.slice(0, 10);
      const aller = res.sessions.find(
        (s) => s.category === "trajet" && s.start.startsWith(day) && s.title.includes("→ Paris") && s.end <= d.start
      );
      expect(aller, `trajet de midi le ${day}`).toBeDefined();
      // La journée finit à Paris, le lendemain commence par un cours à Orsay.
      const retour = res.sessions.find(
        (s) => s.category === "trajet" && s.start.startsWith(day) && s.title.includes("→ Orsay")
      );
      expect(retour, `retour de veille le ${day}`).toBeDefined();
    }
  });

  it("le déjeuner porte un lieu partout où la journée est localisée", () => {
    for (const r of res.sessions.filter((s) => s.category === "repas")) {
      const day = r.start.slice(0, 10);
      const localised = [...res.sessions, ...fixed].some(
        (s) => s.start.startsWith(day) && s.placeId && (s as PlanSession).category !== "trajet"
      );
      if (localised) expect(r.placeId, `déjeuner sans lieu le ${day}`).toBeDefined();
    }
  });

  it("le volume Monumia n'est plus saturé : la charge totale reste raisonnable", () => {
    const monumiaH =
      res.sessions
        .filter((s) => s.category === "monumia")
        .reduce((acc, s) => acc + (new Date(s.end).getTime() - new Date(s.start).getTime()), 0) / 3600000;
    expect(monumiaH).toBeGreaterThanOrEqual(realCfg.work.monumia.minHoursPerWeek);
    // 16h30 de cours + 12h Delos : le score ne doit pas élire le plafond de 30h.
    expect(monumiaH).toBeLessThan(realCfg.work.monumia.maxHoursPerWeek);
  });
});

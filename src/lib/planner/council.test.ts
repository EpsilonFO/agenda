import { describe, expect, it } from "vitest";
import { testConfig as cfg } from "./__fixtures__/testConfig";
import { WEEK, fixedCours } from "./__fixtures__/weekFixtures";
import { WeekInputSchema } from "./contracts";
import { eventsToFixed, resolvePlaceId, runCouncil } from "./council";

/* -------------------------------- Tests ------------------------------- */

describe("runCouncil (v5 : pipeline pur, zéro LLM)", () => {
  const input = WeekInputSchema.parse({ weekStart: WEEK });

  it("produit un WeekPlan complet sans erreur de guardrail, sans aucun chat", async () => {
    const plan = await runCouncil(cfg, input, fixedCours);

    expect(plan.weekStart).toBe(WEEK);
    expect(plan.blockingErrors).toBeUndefined();

    // Delos : 3 demi-journées avec lieu dénormalisé.
    const delos = plan.sessions.filter((s) => s.category === "delos");
    expect(delos).toHaveLength(3);
    expect(delos.every((s) => s.placeName === "Delos")).toBe(true);

    // v5 : rien d'inventé — aucune sortie non demandée, un rappel en warning.
    expect(plan.sessions.filter((s) => s.category === "sortie")).toHaveLength(0);
    expect(plan.warnings?.some((w) => w.includes("Marine"))).toBe(true);

    // Plus de contenu LLM : ni transcript, ni workouts, ni repas.
    expect(plan.transcript).toBeUndefined();
    expect(plan.workouts).toBeUndefined();
    expect(plan.meals).toBeUndefined();
    expect(plan.coachNote).toBeUndefined();

    // Les ids sont conservés (pour la retouche).
    expect(plan.sessions.every((s) => s.id)).toBe(true);
  });

  it("est déterministe : deux runs identiques donnent le même plan", async () => {
    const a = await runCouncil(cfg, input, fixedCours);
    const b = await runCouncil(cfg, input, fixedCours);
    expect(a.sessions).toEqual(b.sessions);
  });

  it("affiche les overrides appliqués (transparence anti-hallucination)", async () => {
    const overridden = WeekInputSchema.parse({
      weekStart: WEEK,
      overrides: { sortiesMarineMin: 0 },
    });
    const plan = await runCouncil(cfg, overridden, fixedCours);
    expect(plan.warnings?.some((w) => w.includes("sortiesMarineMin=0"))).toBe(true);
  });

  it("un plan trop contraint sort avec blockingErrors (jamais auto-appliqué)", async () => {
    // Toute la semaine indisponible : le quota Delos ne peut pas être tenu.
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(`${WEEK}T12:00:00`);
      d.setDate(d.getDate() + i);
      return d.toISOString().slice(0, 10);
    });
    const blocked = WeekInputSchema.parse({
      weekStart: WEEK,
      indisponibilites: days.map((day) => ({ day, reason: "absent" })),
    });
    const plan = await runCouncil(cfg, blocked, []);
    expect(plan.blockingErrors?.length).toBeGreaterThan(0);
  });
});

describe("runCouncil — v5.1", () => {
  const saturday = (() => {
    const d = new Date(`${WEEK}T12:00:00`);
    d.setDate(d.getDate() + 5);
    return d.toISOString().slice(0, 10);
  })();

  it("une décision infaisable est rejetée AVEC sa raison ; la demande et le résumé sont stockés avec le plan", async () => {
    // testConfig : Delos interdit le week-end → « Delos samedi » est rejeté et dit.
    const withDecision = WeekInputSchema.parse({
      weekStart: WEEK,
      decisions: { delos: [{ date: saturday }] },
    });
    const plan = await runCouncil(cfg, withDecision, fixedCours);
    expect(
      plan.warnings?.some((w) => w.includes("Demande non honorée") && w.includes(saturday)),
      plan.warnings?.join(" | ")
    ).toBe(true);
    expect(plan.input).toEqual(withDecision);
    expect(plan.summary).toContain("Monumia");
    expect(plan.summary).toContain("candidats");
  });

  it("une décision faisable est honorée", async () => {
    const wednesday = (() => {
      const d = new Date(`${WEEK}T12:00:00`);
      d.setDate(d.getDate() + 2);
      return d.toISOString().slice(0, 10);
    })();
    const withDecision = WeekInputSchema.parse({
      weekStart: WEEK,
      decisions: { delos: [{ date: wednesday, gabarit: "journee" }] },
    });
    const plan = await runCouncil(cfg, withDecision, fixedCours);
    const delosWed = plan.sessions.filter((s) => s.category === "delos" && s.start.startsWith(wednesday));
    expect(delosWed.length).toBe(2);
    expect(plan.warnings?.some((w) => w.includes("Demande non honorée")) ?? false).toBe(false);
  });

  it("la surcharge sport est affichée (transparence anti-hallucination)", async () => {
    const withSport = WeekInputSchema.parse({
      weekStart: WEEK,
      sport: { imposer: [{ activityId: "course", fois: 2 }] },
    });
    const plan = await runCouncil(cfg, withSport, fixedCours);
    expect(plan.warnings?.some((w) => w.includes("Surcharge sport") && w.includes("course×2"))).toBe(true);
  });
});

describe("helpers", () => {
  it("resolvePlaceId : rattache un lieu par son nom, sinon undefined", () => {
    expect(resolvePlaceId(cfg, "Fac")).toBe("fac");
    expect(resolvePlaceId(cfg, "la bibli")).toBe("bibli");
    expect(resolvePlaceId(cfg, "Chez tonton")).toBeUndefined();
  });

  it("eventsToFixed : mappe les événements avec résolution du lieu", () => {
    const fixed = eventsToFixed(cfg, [
      {
        id: "e1",
        title: "Cours",
        start: "2026-07-21T09:00:00",
        end: "2026-07-21T12:00:00",
        location: "Fac",
        createdAt: "",
        updatedAt: "",
      },
    ]);
    expect(fixed[0].placeId).toBe("fac");
  });

  it("eventsToFixed : un cours SANS lieu est rattaché à la fac (config)", () => {
    const fixed = eventsToFixed(cfg, [
      {
        id: "e2",
        title: "Optimisation",
        start: "2026-07-22T13:45:00",
        end: "2026-07-22T17:00:00",
        category: "travail",
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "e3",
        title: "Rdv mystère sans lieu",
        start: "2026-07-22T18:00:00",
        end: "2026-07-22T19:00:00",
        category: "perso",
        createdAt: "",
        updatedAt: "",
      },
    ]);
    expect(fixed[0].placeId).toBe("fac"); // cours/travail → lieu des cours
    expect(fixed[1].placeId).toBeUndefined(); // perso sans lieu → inconnu
  });
});

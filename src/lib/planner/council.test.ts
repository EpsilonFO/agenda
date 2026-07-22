import { describe, expect, it } from "vitest";
import { testConfig as cfg } from "./__fixtures__/testConfig";
import { WEEK, fixedCours, validJosianeSessions } from "./__fixtures__/weekFixtures";
import { WeekInputSchema } from "./contracts";
import { eventsToFixed, resolvePlaceId, runCouncil, scrubDisliked } from "./council";
import type { ChatFn } from "./llm";

/* ------------------------- Réponses simulées ------------------------- */

const emilienReply = {
  delos: { halfDays: 3, preference: "" },
  monumia: { targetHours: 24, note: "" },
  imprevus: [],
  summary: "Semaine standard.",
  messageToJosiane: "3 demi-journées Delos et 24h de Monumia, s'il te plaît.",
};

const jannikReply = {
  seances: [
    {
      activityId: "salle",
      title: "Salle — haut du corps",
      durationMin: 75,
      preferredDays: ["mardi"],
      preferredMoment: "soir",
      exercises: ["Développé couché 4×8", "Tractions 3×max"],
      tips: ["Échauffement 10 min"],
    },
    {
      activityId: "natation",
      title: "Natation — endurance",
      exercises: ["10×100m crawl"],
      tips: ["Respiration 3 temps"],
    },
    {
      activityId: "course",
      title: "Footing",
      exercises: ["45 min allure facile"],
      tips: ["Hydrate-toi avant"],
    },
  ],
  summary: "Trois séances équilibrées.",
  messageToJosiane: "Garde 48h entre deux muscu.",
};

const djimoReply = {
  sorties: [
    { label: "Soirée Marine", withWhom: "marine", day: null, start: null, durationMin: 180, note: "" },
    { label: "Sortie Marine", withWhom: "marine", day: null, start: null, durationMin: 180, note: "" },
  ],
  summary: "Deux soirées avec Marine.",
  messageToJosiane: "Deux soirées Marine, en soirée.",
};

const simoneReply = {
  meals: [
    {
      day: "2026-07-20",
      slot: "diner",
      title: "Gratin de courgettes",
      steps: ["Couper les courgettes", "Enfourner 30 min"],
      ingredients: [
        { name: "Courgettes", qty: "2" },
        { name: "Riz", qty: "200g" },
      ],
      rationale: "",
    },
    {
      day: "2026-07-21",
      slot: "diner",
      title: "Poulet riz brocoli",
      steps: ["Cuire le riz", "Griller le poulet"],
      ingredients: [
        { name: "Poulet", qty: "300g" },
        { name: "Riz", qty: "200g" },
      ],
      rationale: "Séance salle le soir : protéines.",
    },
  ],
  groceries: [
    { name: "Riz", qty: "400g", aisle: "épicerie" },
    { name: "Poulet", qty: "300g", aisle: "boucherie" },
  ],
  summary: "Simple et costaud.",
};

/** Route chaque appel vers la bonne réponse selon le system prompt. */
function dispatchChat(): ChatFn {
  return async ({ messages }) => {
    const system = String(messages[0]?.content || "");
    if (system.includes("Tu es Emilien")) return { content: JSON.stringify(emilienReply) };
    if (system.includes("Tu es Jannik")) return { content: JSON.stringify(jannikReply) };
    if (system.includes("Tu es Djimo")) return { content: JSON.stringify(djimoReply) };
    if (system.includes("Tu es Simone")) return { content: JSON.stringify(simoneReply) };
    if (system.includes("Tu es Josiane"))
      return {
        content: JSON.stringify({ sessions: validJosianeSessions(), warnings: [], messages: [{ to: "jannik", text: "Ta salle est mardi soir." }] }),
      };
    throw new Error("agent inconnu dans le test");
  };
}

/* -------------------------------- Tests ------------------------------- */

describe("runCouncil (pipeline complet, chat simulé)", () => {
  const input = WeekInputSchema.parse({ weekStart: WEEK });

  it("produit un WeekPlan complet sans erreur de guardrail", async () => {
    const plan = await runCouncil(cfg, input, fixedCours, [], { chat: dispatchChat() });

    expect(plan.weekStart).toBe(WEEK);
    expect(plan.sessions).toHaveLength(15);
    expect(plan.warnings).toBeUndefined();

    // Les lieux sont dénormalisés pour l'affichage.
    const delos = plan.sessions.find((s) => s.title === "Delos matin")!;
    expect(delos.placeName).toBe("Delos");
    // Les ids v2 sont conservés (pour la retouche).
    expect(plan.sessions.every((s) => s.id)).toBe(true);
  });

  it("associe les exercices de Jannik aux séances par activité", async () => {
    const plan = await runCouncil(cfg, input, fixedCours, [], { chat: dispatchChat() });
    expect(plan.workouts).toHaveLength(3);
    const salle = plan.workouts!.find((w) => w.title === "Salle")!;
    expect(salle.exercises).toContain("Développé couché 4×8");
    expect(salle.intensity).toBe("high"); // vient de la config, pas du LLM
    const natation = plan.workouts!.find((w) => w.title === "Natation")!;
    expect(natation.exercises).toContain("10×100m crawl");
  });

  it("construit le transcript de la délibération", async () => {
    const plan = await runCouncil(cfg, input, fixedCours, [], { chat: dispatchChat() });
    const froms = plan.transcript!.map((m) => m.from);
    expect(froms).toContain("emilien");
    expect(froms).toContain("josiane");
    expect(plan.transcript!.every((m) => m.to === "josiane" || m.from === "josiane")).toBe(true);
  });

  it("bannit les aliments détestés des repas (filet déterministe)", async () => {
    const plan = await runCouncil(cfg, input, fixedCours, [], { chat: dispatchChat() });
    const gratin = plan.meals!.find((m) => m.title.includes("courgettes"))!;
    expect(gratin.ingredients.map((i) => i.name)).toEqual([{ name: "Riz", qty: "200g" }.name]);
    expect(gratin.steps.some((s) => s.toLowerCase().includes("courgette"))).toBe(false);
    expect(plan.groceries!.items).toHaveLength(2);
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

  it("scrubDisliked : épargne l'huile d'olive même si les olives sont bannies", () => {
    const meals = scrubDisliked(
      [
        {
          day: "2026-07-20",
          slot: "diner",
          title: "Pâtes",
          steps: ["Arroser d'huile d'olive"],
          ingredients: [
            { name: "Huile d'olive", qty: "1 c.s." },
            { name: "Olives noires", qty: "50g" },
          ],
        },
      ],
      ["olives"]
    );
    expect(meals[0].ingredients.map((i) => i.name)).toEqual(["Huile d'olive"]);
    expect(meals[0].steps).toHaveLength(1);
  });
});

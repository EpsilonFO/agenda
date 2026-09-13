import { describe, expect, it } from "vitest";
import { normalizeChecklist, pendingChecklist, CHECKLIST_MAX_ITEMS } from "./checklist";

describe("normalizeChecklist", () => {
  it("accepte une liste de chaînes (ce que produit le LLM)", () => {
    const items = normalizeChecklist(["appeler Ismael", "  relire le devis  "]);
    expect(items?.map((i) => i.text)).toEqual(["appeler Ismael", "relire le devis"]);
    expect(items?.every((i) => i.done === false)).toBe(true);
    expect(items?.every((i) => i.id.length > 0)).toBe(true);
  });

  it("conserve l'état coché et l'id fourni par le formulaire", () => {
    const items = normalizeChecklist([{ id: "abc", text: "appeler Ismael", done: true }]);
    expect(items).toEqual([{ id: "abc", text: "appeler Ismael", done: true }]);
  });

  it("saute les entrées vides", () => {
    expect(normalizeChecklist(["", "   ", { text: " " }, null, 42])).toBeUndefined();
  });

  it("vaut undefined pour une liste vide ou une valeur non-liste", () => {
    expect(normalizeChecklist([])).toBeUndefined();
    expect(normalizeChecklist(undefined)).toBeUndefined();
    expect(normalizeChecklist("appeler Ismael")).toBeUndefined();
  });

  it("réattribue un id en double", () => {
    const items = normalizeChecklist([
      { id: "x", text: "un" },
      { id: "x", text: "deux" },
    ]);
    expect(items).toHaveLength(2);
    expect(items![0].id).not.toBe(items![1].id);
  });

  it("borne le nombre d'entrées", () => {
    const many = Array.from({ length: CHECKLIST_MAX_ITEMS + 10 }, (_, i) => `tâche ${i}`);
    expect(normalizeChecklist(many)).toHaveLength(CHECKLIST_MAX_ITEMS);
  });

  it("tronque un texte démesuré", () => {
    const items = normalizeChecklist(["a".repeat(500)]);
    expect(items![0].text.length).toBe(240);
  });
});

describe("pendingChecklist", () => {
  it("ne garde que ce qui reste à faire", () => {
    expect(
      pendingChecklist([
        { id: "1", text: "appeler Ismael", done: false },
        { id: "2", text: "relire le devis", done: true },
      ])
    ).toEqual(["appeler Ismael"]);
  });

  it("tolère l'absence de checklist", () => {
    expect(pendingChecklist(undefined)).toEqual([]);
  });
});

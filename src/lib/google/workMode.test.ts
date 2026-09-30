import { describe, expect, it } from "vitest";
import { hasKeyword, showsEventInClear, workKeywordOf } from "./workMode";

describe("workMode", () => {
  it("hasKeyword : casse et accents ignorés, sous-chaîne", () => {
    expect(hasKeyword("Point DELOS du lundi", "delos")).toBe(true);
    expect(hasKeyword("Réunion", "REUNION")).toBe(true);
    expect(hasKeyword("Monumia", "delos")).toBe(false);
    expect(hasKeyword(undefined, "delos")).toBe(false);
  });

  it("workKeywordOf : inactif si décoché ou mot vide", () => {
    expect(workKeywordOf({ workCalendar: true, workKeyword: " Delos " })).toBe("Delos");
    expect(workKeywordOf({ workCalendar: false, workKeyword: "Delos" })).toBeUndefined();
    expect(workKeywordOf({ workCalendar: true, workKeyword: "  " })).toBeUndefined();
    expect(workKeywordOf({})).toBeUndefined();
  });

  it("showsEventInClear : faux seulement si le mode est actif ET le mot absent du titre", () => {
    const pro = { workCalendar: true, workKeyword: "Delos" };
    expect(showsEventInClear(pro, "Monumia — visio")).toBe(false);
    expect(showsEventInClear(pro, "Point Delos")).toBe(true);
    expect(showsEventInClear(pro, undefined)).toBe(true);
    expect(showsEventInClear({ workCalendar: false, workKeyword: "Delos" }, "Monumia")).toBe(true);
    expect(showsEventInClear({}, "Monumia")).toBe(true);
  });
});

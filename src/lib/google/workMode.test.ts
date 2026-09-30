import { describe, expect, it } from "vitest";
import { hasKeyword, matchesWork, showsEventInClear, workKeywordOf } from "./workMode";

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

  it("matchesWork : titre, adresse d'un participant, adresse de l'organisateur", () => {
    expect(matchesWork({ title: "Point Delos" }, "delos")).toBe(true);
    // « Félix Evan, Pierre » : rien dans le titre, mais des collègues @delosintelligence.
    const reunion = {
      title: "Félix Evan, Pierre",
      attendees: [{ email: "evan@DelosIntelligence.fr" }, { email: "pierre@delosintelligence.fr" }],
    };
    expect(matchesWork(reunion, "delos")).toBe(true);
    expect(matchesWork({ title: "Dentiste", attendees: [{ email: "x@gmail.com" }] }, "delos")).toBe(false);
    expect(
      matchesWork({ title: "Invitation", google: { organizer: { email: "boss@delosintelligence.fr" } } }, "delos")
    ).toBe(true);
  });

  it("matchesWork : JAMAIS sur sa propre adresse (elle est dans tous les événements du calendrier)", () => {
    const monumia = {
      title: "Monumia — point",
      attendees: [{ email: "felixollivier@delosintelligence.fr", self: true }, { email: "paul@monumia.fr" }],
      google: { organizer: { email: "felixollivier@delosintelligence.fr", self: true } },
    };
    expect(matchesWork(monumia, "delos")).toBe(false);
  });

  it("showsEventInClear : faux seulement si le mode est actif ET l'événement ne concerne pas le mot", () => {
    const pro = { workCalendar: true, workKeyword: "Delos" };
    expect(showsEventInClear(pro, { title: "Monumia — visio" })).toBe(false);
    expect(showsEventInClear(pro, { title: "Point Delos" })).toBe(true);
    // Des invités Delos ramènent l'événement sur le calendrier Delos.
    expect(showsEventInClear(pro, { title: "Point", attendees: [{ email: "a@delosintelligence.fr" }] })).toBe(true);
    expect(showsEventInClear(pro, undefined)).toBe(true);
    expect(showsEventInClear({ workCalendar: false, workKeyword: "Delos" }, { title: "Monumia" })).toBe(true);
    expect(showsEventInClear({}, { title: "Monumia" })).toBe(true);
  });
});

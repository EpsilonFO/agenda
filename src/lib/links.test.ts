import { describe, expect, it } from "vitest";
import { extractLinks } from "./links";

describe("extractLinks", () => {
  it("repère une URL écrite au milieu d'une phrase", () => {
    const [link] = extractLinks("On se voit ici : https://example.org/salle-3 à 14h.");
    expect(link.url).toBe("https://example.org/salle-3");
    expect(link.meeting).toBe(false);
  });

  it("reconnaît le lien de visio que Google colle dans les notes", () => {
    const [link] = extractLinks("Visio : https://meet.google.com/abc-defg-hij");
    expect(link.url).toBe("https://meet.google.com/abc-defg-hij");
    expect(link.host).toBe("meet.google.com");
    expect(link.meeting).toBe(true);
  });

  it("accepte un lien de visio écrit sans schéma", () => {
    const [link] = extractLinks("rdv sur meet.google.com/abc-defg-hij");
    expect(link.url).toBe("https://meet.google.com/abc-defg-hij");
    expect(link.meeting).toBe(true);
  });

  it("complète les URL en www.", () => {
    const [link] = extractLinks("www.example.org/doc");
    expect(link.url).toBe("https://www.example.org/doc");
    expect(link.host).toBe("example.org");
  });

  it("laisse la ponctuation finale en dehors du lien", () => {
    expect(extractLinks("doc ici : https://example.org/a.")[0].url).toBe(
      "https://example.org/a"
    );
    expect(extractLinks("(https://example.org/a)")[0].url).toBe("https://example.org/a");
    expect(extractLinks("« https://example.org/a »")[0].url).toBe("https://example.org/a");
  });

  it("garde les parenthèses qui appartiennent au chemin", () => {
    expect(extractLinks("https://example.org/a_(b)")[0].url).toBe(
      "https://example.org/a_(b)"
    );
  });

  it("reconnaît un sous-domaine Zoom comme une visio", () => {
    const [link] = extractLinks("https://univ-paris.zoom.us/j/123456789");
    expect(link.meeting).toBe(true);
  });

  it("parcourt plusieurs textes et dédoublonne", () => {
    const links = extractLinks(
      "Visio : https://meet.google.com/abc puis https://example.org/notes",
      "https://meet.google.com/abc"
    );
    expect(links.map((l) => l.url)).toEqual([
      "https://meet.google.com/abc",
      "https://example.org/notes",
    ]);
  });

  it("ne renvoie rien sur un texte sans lien", () => {
    expect(extractLinks("appeler Ismael", undefined, "")).toEqual([]);
    expect(extractLinks("rdv 14h30 salle B2.14")).toEqual([]);
  });

  it("abrège un lien trop long sans perdre l'hôte", () => {
    const [link] = extractLinks(`https://example.org/${"x".repeat(120)}`);
    expect(link.label.startsWith("example.org/")).toBe(true);
    expect(link.label.length).toBeLessThanOrEqual(41);
  });
});

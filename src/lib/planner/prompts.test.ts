import { describe, expect, it } from "vitest";
import { testConfig as cfg } from "./__fixtures__/testConfig";
import {
  buildDjimoSystem,
  buildEmilienSystem,
  buildJannikSystem,
  buildJosianeSystem,
  buildSimoneSystem,
} from "./prompts";

/** Les règles chiffrées viennent de la config, pas du texte des prompts. */
describe("prompts générés depuis la config", () => {
  it("Emilien : quotas Delos et Monumia injectés", () => {
    const p = buildEmilienSystem(cfg);
    expect(p).toContain("3 demi-journées");
    expect(p).toContain("09:00-13:00 ou 14:00-18:00");
    expect(p).toContain("20h/semaine");
    expect(p).toContain("8h/jour");
  });

  it("Jannik : activités de la config, créneau fixe, statut optionnel", () => {
    const p = buildJannikSystem(cfg);
    expect(p).toContain("3 à 4 séances");
    expect(p).toContain("[natation]");
    expect(p).toContain("CRÉNEAU IMPOSÉ : jeudi 18:00-19:00");
    expect(p).toContain("récup ≥ 48h");
    // L'escalade est "optionnel" : présentée à Jannik avec son statut.
    expect(p).toContain("OPTIONNEL : seulement si demandé");
  });

  it("Djimo : objectif Marine signalé mais jamais inventé", () => {
    const p = buildDjimoSystem(cfg);
    expect(p).toContain("L'objectif est 2 sorties Marine");
    expect(p).toContain("Tu n'INVENTES JAMAIS une sortie");
    expect(p).toContain("tu ne crées rien pour combler");
  });

  it("Josiane : horaires, trajets, priorités et interdits injectés", () => {
    const p = buildJosianeSystem(cfg);
    expect(p).toContain("08:00");
    expect(p).toContain("22:00");
    expect(p).toContain("35 min en voiture / 70 min en transports");
    expect(p).toContain("interdit : voiture"); // Delos
    expect(p).toContain("aller-retour entre zones dans la même journée");
    expect(p).toContain("pour déjeuner");
    expect(p).toContain("trou > 60 min");
    expect(p).toContain("minimum 20h/sem");
    // Les activités optionnelles ne sont PAS proposées à Josiane par défaut.
    expect(p).not.toContain("[escalade]");
  });

  it("Simone : budget, aliments bannis et règles repas injectés", () => {
    const p = buildSimoneSystem(cfg);
    expect(p).toContain("ÉTUDIANT");
    expect(p).toContain("courgettes, chèvre");
    expect(p).toContain("CROUS");
    expect(p).toContain("chez les parents");
  });

  it("chaque prompt tient sur ~un écran (< 3000 caractères)", () => {
    for (const build of [
      buildEmilienSystem,
      buildJannikSystem,
      buildDjimoSystem,
      buildSimoneSystem,
    ]) {
      expect(build(cfg).length).toBeLessThan(3000);
    }
    // Josiane porte toutes les règles de placement : nettement plus longue.
    expect(buildJosianeSystem(cfg).length).toBeLessThan(7000);
  });
});

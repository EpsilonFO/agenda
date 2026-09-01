import { describe, expect, it } from "vitest";
import { testConfig as cfg } from "./__fixtures__/testConfig";
import {
  buildDjimoChatSystem,
  buildEmilienChatSystem,
  buildJannikChatSystem,
  buildJosianeRetouchSystem,
  buildSimoneChatSystem,
} from "./prompts";

/** Les règles chiffrées viennent de la config, pas du texte des prompts. */
describe("prompts générés depuis la config (v5 : retouche + chats)", () => {
  it("retouche : opérations minimales, trajets et horaires injectés", () => {
    const p = buildJosianeRetouchSystem(cfg);
    expect(p).toContain("opérations");
    expect(p).toContain("35 min en voiture / 70 min en transports");
    expect(p).toContain("interdit : voiture"); // Delos
    expect(p).toContain("aller-retour entre zones dans la même journée");
    expect(p).toContain("08:00");
    expect(p).toContain("22:00");
  });

  it("chat Jannik : activités de la config, créneau fixe, statut optionnel", () => {
    const p = buildJannikChatSystem(cfg);
    expect(p).toContain("[natation]");
    expect(p).toContain("CRÉNEAU IMPOSÉ : jeudi 18:00-19:00");
    expect(p).toContain("récup ≥ 48h");
    expect(p).toContain("OPTIONNEL : seulement si demandé");
  });

  it("chat Emilien : quotas travail injectés", () => {
    const p = buildEmilienChatSystem(cfg);
    expect(p).toContain("3 demi-journées");
    expect(p).toContain("20h/sem");
  });

  it("chat Djimo : objectif Marine injecté", () => {
    const p = buildDjimoChatSystem(cfg);
    expect(p).toContain("2 sorties Marine");
  });

  it("chat Simone : budget et aliments bannis injectés", () => {
    const p = buildSimoneChatSystem(cfg);
    expect(p).toContain("etudiant");
    expect(p).toContain("courgettes, chèvre");
  });

  it("les chats sont en lecture seule : toute modification renvoie ailleurs", () => {
    for (const build of [
      buildJannikChatSystem,
      buildEmilienChatSystem,
      buildDjimoChatSystem,
      buildSimoneChatSystem,
    ]) {
      expect(build(cfg)).toContain("toi, tu conseilles");
    }
  });

  it("chaque prompt tient sur ~un écran (< 3000 caractères)", () => {
    for (const build of [
      buildJannikChatSystem,
      buildEmilienChatSystem,
      buildDjimoChatSystem,
      buildSimoneChatSystem,
      buildJosianeRetouchSystem,
    ]) {
      expect(build(cfg).length).toBeLessThan(3000);
    }
  });
});

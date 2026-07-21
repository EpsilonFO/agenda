import { describe, expect, it } from "vitest";
import { loadLifeConfig, travelMinutes } from "./config";

describe("life-config.json", () => {
  it("se charge et passe la validation zod", async () => {
    const cfg = await loadLifeConfig();
    expect(cfg.version).toBe(1);
    expect(cfg.clusters.map((c) => c.id).sort()).toEqual(["orsay", "paris"]);
    expect(cfg.work.delos.halfDaysPerWeek).toBe(3);
    expect(cfg.work.monumia.minHoursPerWeek).toBe(20);
    expect(cfg.sorties.copine.perWeekMin).toBe(2);
  });

  it("calcule les trajets par clusters", async () => {
    const cfg = await loadLifeConfig();

    // Intra-Orsay : forfait 15 min.
    expect(travelMinutes(cfg, "chambre-orsay", "ens-saclay")?.minutes).toBe(15);

    // Orsay → appart parents : inter-cluster, voiture la plus rapide (35 min).
    expect(travelMinutes(cfg, "chambre-orsay", "maison-paris")).toEqual({
      minutes: 35,
      mode: "voiture",
    });

    // Orsay → Delos : la voiture est INTERDITE à destination → transports (70 min).
    expect(travelMinutes(cfg, "chambre-orsay", "delos")).toEqual({
      minutes: 70,
      mode: "transports",
    });

    // Même lieu : 0 min.
    expect(travelMinutes(cfg, "delos", "delos")?.minutes).toBe(0);
  });
});

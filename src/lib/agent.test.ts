/**
 * Tests de la robustesse des overrides côté hôte (agent.ts / toWeekInput).
 *
 * Vécu : le modèle hôte a mis les quotas à 0 sans que l'utilisateur ne le
 * demande, vidant la semaine (0 Delos, 0 sport). Défense en deux temps :
 *   - le schéma borne les quotas souples (pas de 0) et bannit tout override
 *     Delos (les 3 demi-journées sont une RÈGLE) ;
 *   - toWeekInput rejette un override hors-bornes sans sacrifier le reste de
 *     la demande structurée.
 */

import { describe, expect, it } from "vitest";
import { toWeekInput } from "./agent";

describe("toWeekInput — overrides", () => {
  it("rejette une remise à 0 des quotas, sans toucher au reste de la demande", () => {
    const input = toWeekInput({
      weekStart: "2026-07-27",
      imprevus: [{ label: "TP réseau", hoursNeeded: 4 }],
      overrides: { sportSessionsMax: 0, monumiaMinHours: 0 },
    });
    // Overrides fautifs ignorés → quotas normaux conservés.
    expect(input.overrides).toEqual({});
    // La demande structurée survit.
    expect(input.imprevus).toHaveLength(1);
    expect(input.imprevus[0].label).toBe("TP réseau");
  });

  it("ignore un override Delos (règle non surchargeable) mais garde le reste", () => {
    const input = toWeekInput({
      weekStart: "2026-07-27",
      overrides: { delosHalfDays: 0, sportSessionsMax: 2 },
    });
    // delosHalfDays n'existe plus au schéma (clé inconnue, ignorée) ;
    // sportSessionsMax=2 est dans les bornes → conservé.
    expect(input.overrides).toEqual({ sportSessionsMax: 2 });
  });

  it("laisse passer une exception souple légitime (« semaine chargée » → 2 séances)", () => {
    const input = toWeekInput({
      weekStart: "2026-07-27",
      overrides: { sportSessionsMax: 2 },
    });
    expect(input.overrides.sportSessionsMax).toBe(2);
  });

  it("sans overrides : demande propre, quotas normaux", () => {
    const input = toWeekInput({ weekStart: "2026-07-27" });
    expect(input.overrides).toEqual({});
  });
});

describe("toWeekInput — surcharge sport (v5)", () => {
  it("laisse passer une surcharge bien formée", () => {
    const input = toWeekInput({
      weekStart: "2026-07-27",
      sport: { exclure: ["natation"], imposer: [{ activityId: "escalade", fois: 2 }] },
    });
    expect(input.sport.exclure).toEqual(["natation"]);
    expect(input.sport.imposer).toEqual([{ activityId: "escalade", fois: 2 }]);
  });

  it("rejette une surcharge mal formée sans sacrifier le reste", () => {
    const input = toWeekInput({
      weekStart: "2026-07-27",
      imprevus: [{ label: "TP réseau", hoursNeeded: 4 }],
      sport: { imposer: [{ activityId: "course", fois: 99 }] },
    });
    // Surcharge fautive ignorée → rotation normale, la demande survit.
    expect(input.sport).toEqual({ exclure: [], imposer: [] });
    expect(input.imprevus).toHaveLength(1);
  });
});

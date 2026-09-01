import { describe, expect, it } from "vitest";
import {
  googleDateTimeToLocalIso,
  instantToLocalIso,
  localIsoToInstant,
  localIsoToRfc3339,
  overlapsWindow,
  tzOffsetMinutes,
} from "./time";

const TZ = "Europe/Paris";

describe("time — conversions agenda ⇄ Google (fuseau explicite)", () => {
  it("été : décalage +02:00", () => {
    expect(localIsoToRfc3339("2026-07-14T09:00:00", TZ)).toBe("2026-07-14T09:00:00+02:00");
  });

  it("hiver : décalage +01:00, secondes optionnelles", () => {
    expect(localIsoToRfc3339("2026-01-14T09:00", TZ)).toBe("2026-01-14T09:00:00+01:00");
  });

  it("Google → local : n'importe quel décalage d'entrée", () => {
    expect(googleDateTimeToLocalIso("2026-07-14T07:00:00Z", TZ)).toBe("2026-07-14T09:00:00");
    expect(googleDateTimeToLocalIso("2026-07-14T03:00:00-04:00", TZ)).toBe("2026-07-14T09:00:00");
    expect(googleDateTimeToLocalIso("2026-07-14T09:00:00+02:00", TZ)).toBe("2026-07-14T09:00:00");
  });

  it("minuit local ne bascule pas de jour", () => {
    expect(googleDateTimeToLocalIso("2026-07-13T22:00:00Z", TZ)).toBe("2026-07-14T00:00:00");
  });

  it("aller-retour stable", () => {
    const iso = "2026-11-03T18:30:00";
    expect(instantToLocalIso(localIsoToInstant(iso, TZ), TZ)).toBe(iso);
  });

  it("une chaîne déjà datée d'un décalage est prise telle quelle", () => {
    expect(localIsoToInstant("2026-07-14T09:00:00+02:00", TZ).toISOString()).toBe(
      "2026-07-14T07:00:00.000Z"
    );
    expect(localIsoToInstant("2026-07-14T07:00:00Z", TZ).toISOString()).toBe(
      "2026-07-14T07:00:00.000Z"
    );
  });

  it("passage à l'heure d'été : 02:30 n'existe pas → 03:30", () => {
    // Dimanche 29 mars 2026, 02:00 → 03:00 à Paris.
    const inst = localIsoToInstant("2026-03-29T02:30:00", TZ);
    expect(instantToLocalIso(inst, TZ)).toBe("2026-03-29T03:30:00");
    expect(inst.toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });

  it("offset du fuseau", () => {
    expect(tzOffsetMinutes(new Date("2026-07-14T07:00:00Z"), TZ)).toBe(120);
    expect(tzOffsetMinutes(new Date("2026-01-14T07:00:00Z"), TZ)).toBe(60);
    expect(tzOffsetMinutes(new Date("2026-07-14T07:00:00Z"), "UTC")).toBe(0);
  });

  it("indépendant du fuseau du process : même résultat pour un autre fuseau demandé", () => {
    expect(googleDateTimeToLocalIso("2026-07-14T07:00:00Z", "America/New_York")).toBe(
      "2026-07-14T03:00:00"
    );
  });

  it("overlapsWindow : critère [start, end) ∩ [wStart, wEnd)", () => {
    const ws = new Date("2026-09-01T00:00:00Z");
    const we = new Date("2026-09-08T00:00:00Z");
    expect(overlapsWindow(new Date("2026-08-31T22:00:00Z"), new Date("2026-09-01T01:00:00Z"), ws, we)).toBe(true);
    expect(overlapsWindow(new Date("2026-08-31T20:00:00Z"), new Date("2026-09-01T00:00:00Z"), ws, we)).toBe(false);
    expect(overlapsWindow(new Date("2026-09-08T00:00:00Z"), new Date("2026-09-08T01:00:00Z"), ws, we)).toBe(false);
  });
});

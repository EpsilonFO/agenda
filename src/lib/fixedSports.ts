import type { LifeConfig } from "./planner/config";
import type { EventItem } from "./types";
import { colorFor } from "./colors";
import { FULL_WEEKDAYS, mondayIndex, parseIso, startOfDay } from "./dates";

/**
 * Sports IMPOSÉS à créneau fixe (réglages → Sport : statut « imposé » +
 * « Créneau imposé »), montrés d'office dans l'agenda — sans attendre que
 * Josiane planifie la semaine.
 *
 * Ce ne sont que des APERÇUS (`preview`), jamais écrits dans events.json :
 * cliquer dessus ouvre la fiche pré-remplie pour en faire un vrai événement.
 * Dès qu'un événement de sport occupe le créneau (plan de la semaine, ou
 * séance ajoutée à la main), l'aperçu s'efface. Rien pour les jours passés :
 * une séance qu'on n'a pas notée n'a sans doute pas eu lieu.
 */
export function fixedSportPreviews(
  cfg: Pick<LifeConfig, "sport" | "places">,
  days: Date[],
  events: EventItem[],
  now: Date = new Date()
): EventItem[] {
  const today = startOfDay(now).getTime();
  const out: EventItem[] = [];
  for (const act of cfg.sport.activities) {
    const slot = act.fixedSlot;
    if (act.status !== "impose" || !slot) continue;
    const place = cfg.places.find((p) => p.id === act.placeIds[0]);
    for (const day of days) {
      if (startOfDay(day).getTime() < today) continue;
      if (FULL_WEEKDAYS[mondayIndex(day)] !== slot.weekday) continue;
      const start = atTime(day, slot.start);
      const end = atTime(day, slot.end);
      if (end <= start) continue;
      const taken = events.some((ev) => {
        const s = parseIso(ev.start);
        const e = parseIso(ev.end);
        return (
          s < end &&
          start < e &&
          (ev.category === "sport" || ev.title.trim() === act.name.trim())
        );
      });
      if (taken) continue;
      const date = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
      out.push({
        id: `fixed-sport:${act.id}:${date}`,
        title: act.name,
        start: `${date}T${slot.start}:00`,
        end: `${date}T${slot.end}:00`,
        category: "sport",
        color: colorFor("sport"),
        location: place?.name,
        preview: true,
        createdAt: "",
        updatedAt: "",
      });
    }
  }
  return out;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function atTime(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

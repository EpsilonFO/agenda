/**
 * Écriture d'un plan de semaine dans l'agenda — déterministe (aucun LLM) et
 * IDEMPOTENTE : réécrire une même semaine efface d'abord les événements issus
 * d'un plan précédent (source "plan") pour éviter les doublons, sans toucher
 * aux cours ni aux événements fixes créés à la main.
 */

import { listEvents, createEvent, deleteEvent, saveWeekPlan } from "./store";
import { addDays, parseIso, parseFlexibleDate, startOfWeek, toLocalIso } from "./dates";
import type { WeekPlan, WorkoutPlan } from "./types";

const CATEGORY_COLORS: Record<string, string> = {
  travail: "#6366f1",
  perso: "#10b981",
  sport: "#f59e0b",
  santé: "#ef4444",
  sante: "#ef4444",
  famille: "#ec4899",
  loisir: "#06b6d4",
  // Catégories du planner v2
  delos: "#6366f1",
  monumia: "#8b5cf6",
  sortie: "#06b6d4",
  autre: "#94a3b8",
};

function colorFor(category?: string): string {
  if (!category) return "#6366f1";
  return CATEGORY_COLORS[category.toLowerCase()] || "#6366f1";
}

function workoutText(w?: WorkoutPlan): string | undefined {
  if (!w) return undefined;
  const parts: string[] = [];
  if (w.exercises.length) parts.push(`Exos : ${w.exercises.join(" · ")}`);
  if (w.tips.length) parts.push(`Conseils : ${w.tips.join(" · ")}`);
  return parts.length ? parts.join(" | ") : undefined;
}

/**
 * Écrit le plan dans l'agenda et le persiste. Renvoie le nombre d'événements créés.
 */
export async function commitWeekPlan(plan: WeekPlan): Promise<number> {
  const sessions = Array.isArray(plan.sessions) ? plan.sessions : [];

  // Fenêtre de la semaine visée.
  const weekStart = startOfWeek(parseFlexibleDate(plan.weekStart));
  const weekEnd = addDays(weekStart, 7);

  // 1) Purge des événements du plan précédent pour cette semaine (idempotence).
  const existing = await listEvents();
  for (const ev of existing) {
    if (ev.source !== "plan") continue;
    const d = parseIso(ev.start);
    if (d >= weekStart && d < weekEnd) await deleteEvent(ev.id);
  }

  // 2) Écriture des nouvelles séances.
  const workoutByStart = new Map(
    (plan.workouts || []).map((w) => [w.sessionStart, w])
  );
  let created = 0;
  for (const s of sessions) {
    if (!s.title || !s.start || !s.end) continue;
    const parts = [
      s.rationale,
      s.transportMode
        ? `Trajet : ${s.transportMode}${
            s.travelFromPrevMin ? ` (${s.travelFromPrevMin} min)` : ""
          }`
        : undefined,
      workoutText(workoutByStart.get(s.start)),
    ].filter(Boolean);
    await createEvent({
      title: s.title,
      start: s.start,
      end: s.end,
      description: parts.length ? parts.join(" · ") : undefined,
      location: s.placeName || undefined,
      category: s.category,
      color: colorFor(s.category),
      source: "plan",
    });
    created++;
  }

  // 3) Persiste le plan complet (repas, courses, transcript) pour l'affichage
  //    et la retouche incrémentale ultérieure.
  await saveWeekPlan({
    ...plan,
    weekStart: toLocalIso(weekStart).slice(0, 10),
    committed: true,
  });

  return created;
}

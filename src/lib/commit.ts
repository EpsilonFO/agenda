/**
 * Écriture d'un plan de semaine dans l'agenda — déterministe (aucun LLM) et
 * IDEMPOTENTE : réécrire une même semaine remplace les événements issus d'un
 * plan précédent (source "plan") sans doublon, sans toucher aux cours ni aux
 * événements fixes créés à la main. L'accord avec les retouches faites à la
 * main vit dans planSync.ts.
 */

import { mutateEvents, newEventId, saveWeekPlan } from "./store";
import { addDays, parseIso, parseFlexibleDate, startOfWeek, toLocalIso } from "./dates";
import { colorFor } from "./colors";
import { matchSessionsToEvents, withUniqueSessionIds } from "./planSync";
import type { EventItem, WeekPlan, WorkoutPlan } from "./types";

function workoutText(w?: WorkoutPlan): string | undefined {
  if (!w) return undefined;
  const parts: string[] = [];
  if (w.exercises.length) parts.push(`Exos : ${w.exercises.join(" · ")}`);
  if (w.tips.length) parts.push(`Conseils : ${w.tips.join(" · ")}`);
  return parts.length ? parts.join(" | ") : undefined;
}

/**
 * Écrit le plan dans l'agenda et le persiste. Renvoie le nombre de séances écrites.
 *
 * Un événement qui montre déjà une séance est MIS À JOUR EN PLACE (même id) :
 * sa checklist, son rappel et ses notes survivent à la retouche, et sa copie
 * Google est patchée plutôt que supprimée puis recréée. Appariement : même
 * créneau d'abord (ce qui n'a pas bougé reste tel quel), puis même séance
 * (planSessionId, même catégorie) pour ce qu'une retouche a déplacé.
 */
export async function commitWeekPlan(plan: WeekPlan): Promise<number> {
  const sessions = withUniqueSessionIds(Array.isArray(plan.sessions) ? plan.sessions : []);
  const writable = sessions.filter((s) => s.title && s.start && s.end);

  // Fenêtre de la semaine visée.
  const weekStart = startOfWeek(parseFlexibleDate(plan.weekStart));
  const weekEnd = addDays(weekStart, 7);
  const inWeekPlan = (ev: EventItem) => {
    if (ev.source !== "plan") return false;
    const d = parseIso(ev.start);
    return d >= weekStart && d < weekEnd;
  };

  const workoutByStart = new Map(
    (plan.workouts || []).map((w) => [w.sessionStart, w])
  );

  // Une seule transaction sur events.json : les événements du plan précédent
  // qui ne montrent plus aucune séance disparaissent (idempotence), les autres
  // sont mis à jour, les séances sans événement en reçoivent un.
  await mutateEvents((events) => {
    const existing = events.filter(inWeekPlan);
    const matched = matchSessionsToEvents(writable, existing, ["slot", "idKind"]);
    const stamp = new Date().toISOString();
    const kept = new Map<string, EventItem>();
    const created: EventItem[] = [];

    writable.forEach((s, i) => {
      const fields = {
        title: s.title,
        start: s.start,
        end: s.end,
        location: s.placeName || undefined,
        category: s.category,
        color: colorFor(s.category),
        planSessionId: s.id,
      };
      const ev = matched[i];
      if (ev) {
        const same = (Object.keys(fields) as (keyof typeof fields)[]).every(
          (k) => ev[k] === fields[k]
        );
        kept.set(ev.id, same ? ev : { ...ev, ...fields, updatedAt: stamp });
        return;
      }
      const parts = [
        s.rationale,
        s.transportMode
          ? `Trajet : ${s.transportMode}${
              s.travelFromPrevMin ? ` (${s.travelFromPrevMin} min)` : ""
            }`
          : undefined,
        workoutText(workoutByStart.get(s.start)),
      ].filter(Boolean);
      created.push({
        ...fields,
        id: newEventId(),
        description: parts.length ? parts.join(" · ") : undefined,
        source: "plan",
        createdAt: stamp,
        updatedAt: stamp,
      });
    });

    return [
      ...events
        .filter((ev) => !inWeekPlan(ev) || kept.has(ev.id))
        .map((ev) => kept.get(ev.id) ?? ev),
      ...created,
    ];
  });

  // Persiste le plan complet (ids de séance compris : ce sont eux qui relient
  // les événements au plan) pour l'affichage et la retouche ultérieure.
  await saveWeekPlan({
    ...plan,
    sessions,
    weekStart: toLocalIso(weekStart).slice(0, 10),
    committed: true,
  });

  return writable.length;
}

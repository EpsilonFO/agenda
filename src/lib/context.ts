/**
 * Contexte DÉTERMINISTE injecté quand on discute avec un agent précis.
 *
 * Objectif : quand l'utilisateur parle à Jannik mardi 15h30 et qu'une séance
 * dos/biceps est à l'agenda à ce moment-là, Jannik le sait — avec le détail de
 * la séance (exercices/conseils). Même logique pour Simone (le plat du jour),
 * Emilien (le bloc de travail), Djimo (le moment perso), Josiane (la journée).
 *
 * Rien n'est inventé ici : tout vient de l'agenda et du plan stockés.
 */

import { listEvents, getWeekPlan, getProfile } from "./store";
import {
  parseIso,
  startOfWeek,
  toLocalIso,
  sameDay,
  formatFullDate,
  formatTime,
} from "./dates";
import type { AgentName, EventItem, WeekPlan, WorkoutPlan } from "./types";

const CATEGORIES: Record<AgentName, string[]> = {
  jannik: ["sport"],
  emilien: ["travail"],
  djimo: ["loisir", "perso", "famille"],
  josiane: [], // tout
  simone: [], // géré via les repas
};

function eventLine(e: EventItem): string {
  const s = parseIso(e.start);
  const en = parseIso(e.end);
  const loc = e.location ? ` @ ${e.location}` : "";
  return `${formatTime(s)}–${formatTime(en)} ${e.title}${loc} [${
    e.category || "?"
  }]`;
}

function workoutDetail(plan: WeekPlan | null, e: EventItem): string | null {
  const w: WorkoutPlan | undefined = plan?.workouts?.find(
    (x) => x.sessionStart === e.start
  );
  if (w && (w.exercises.length || w.tips.length)) {
    const parts: string[] = [];
    if (w.exercises.length) parts.push(`  Exercices : ${w.exercises.join(" · ")}`);
    if (w.tips.length) parts.push(`  Conseils : ${w.tips.join(" · ")}`);
    return parts.join("\n");
  }
  // Repli : le détail est peut-être dans la description de l'événement.
  return e.description ? `  ${e.description}` : null;
}

/** Construit le bloc de contexte pour l'agent, à l'instant `nowIso`. */
export async function buildAgentContext(
  agent: AgentName,
  nowIso?: string
): Promise<string> {
  const now = nowIso && !Number.isNaN(Date.parse(nowIso)) ? new Date(nowIso) : new Date();
  const weekStartStr = toLocalIso(startOfWeek(now)).slice(0, 10);
  const todayStr = toLocalIso(now).slice(0, 10);

  const [events, plan] = await Promise.all([
    listEvents(),
    getWeekPlan(weekStartStr),
  ]);

  const header = `CONTEXTE (déterministe — n'invente rien, appuie-toi dessus) :\nMAINTENANT : ${formatFullDate(
    now
  )} à ${formatTime(now)}.`;

  // --- Simone : le menu du jour ---
  if (agent === "simone") {
    const profile = await getProfile();
    const disliked = profile.dislikedFoods?.length
      ? `\n\nALIMENTS À ÉVITER (ne les propose jamais) : ${profile.dislikedFoods.join(", ")}`
      : "";
    const meals = (plan?.meals || []).filter((m) => m.day === todayStr);
    if (meals.length === 0) {
      return `${header}\n\nAucun repas n'est prévu à préparer aujourd'hui (peut-être CROUS, resto, ou chez les parents).${disliked}`;
    }
    const block = meals
      .map((m) => {
        const ing = m.ingredients
          .map((i) => `${i.name}${i.qty ? ` (${i.qty})` : ""}`)
          .join(", ");
        return `• ${m.slot} — ${m.title}\n  Ingrédients : ${ing}\n  Recette : ${m.steps.join(
          " ; "
        )}${m.rationale ? `\n  (${m.rationale})` : ""}`;
      })
      .join("\n");
    return `${header}\n\nLE MENU PRÉVU AUJOURD'HUI :\n${block}${disliked}`;
  }

  // --- Autres agents : événements du jour dans leur domaine ---
  const cats = CATEGORIES[agent];
  const inScope = (e: EventItem) =>
    agent === "josiane" || cats.includes((e.category || "").toLowerCase());

  const todays = events
    .filter((e) => sameDay(parseIso(e.start), now) && inScope(e))
    .sort((a, b) => a.start.localeCompare(b.start));

  const current = todays.find(
    (e) => parseIso(e.start) <= now && now < parseIso(e.end)
  );
  const next = todays.find((e) => parseIso(e.start) > now);

  const parts: string[] = [header];

  if (current) {
    let line = `EN CE MOMENT : ${eventLine(current)}`;
    if (agent === "jannik") {
      const detail = workoutDetail(plan, current);
      if (detail) line += `\n${detail}`;
    } else if (current.description) {
      line += `\n  ${current.description}`;
    }
    parts.push(line);
  } else if (next) {
    let line = `PROCHAINEMENT AUJOURD'HUI : ${eventLine(next)}`;
    if (agent === "jannik") {
      const detail = workoutDetail(plan, next);
      if (detail) line += `\n${detail}`;
    } else if (next.description) {
      line += `\n  ${next.description}`;
    }
    parts.push(line);
  }

  if (todays.length > 0) {
    const label =
      agent === "josiane" ? "TON EMPLOI DU TEMPS AUJOURD'HUI" : "DANS TON DOMAINE AUJOURD'HUI";
    parts.push(`${label} :\n${todays.map((e) => `- ${eventLine(e)}`).join("\n")}`);
  } else {
    parts.push("(rien de prévu dans ton domaine aujourd'hui)");
  }

  if (agent === "josiane" && plan?.warnings?.length) {
    parts.push(`POINTS DE VIGILANCE :\n${plan.warnings.map((w) => `- ${w}`).join("\n")}`);
  }

  return parts.join("\n\n");
}

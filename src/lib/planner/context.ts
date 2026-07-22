/**
 * Contexte DÉTERMINISTE injecté quand on discute avec un agent précis.
 *
 * Quand Felix parle à Jannik mardi 15h30 et qu'une séance dos/biceps est à
 * l'agenda, Jannik le sait — avec les exercices du plan. Même logique pour
 * Simone (le menu du jour), Emilien (le bloc de travail), Djimo (les sorties),
 * Josiane (toute la journée + points de vigilance).
 *
 * Rien n'est inventé : tout vient de l'agenda et du plan stockés.
 */

import { listEvents, getWeekPlan } from "../store";
import {
  parseIso,
  startOfWeek,
  toLocalIso,
  sameDay,
  formatFullDate,
  formatTime,
} from "../dates";
import type { AgentName, EventItem, WeekPlan, WorkoutPlan } from "../types";

/** Catégories d'événements qui relèvent de chaque agent (v2 + héritage v1). */
const CATEGORIES: Record<AgentName, string[]> = {
  jannik: ["sport"],
  emilien: ["delos", "monumia", "travail", "cours"],
  djimo: ["sortie", "loisir", "perso", "famille"],
  josiane: [], // tout
  simone: [], // géré via les repas du plan
};

function eventLine(e: EventItem): string {
  const s = parseIso(e.start);
  const en = parseIso(e.end);
  const loc = e.location ? ` @ ${e.location}` : "";
  return `${formatTime(s)}–${formatTime(en)} ${e.title}${loc} [${e.category || "?"}]`;
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
  return e.description ? `  ${e.description}` : null;
}

/** Construit le bloc de contexte pour l'agent, à l'instant `nowIso`. */
export async function buildDayContext(
  agent: AgentName,
  nowIso?: string
): Promise<string> {
  const now =
    nowIso && !Number.isNaN(Date.parse(nowIso)) ? new Date(nowIso) : new Date();
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
    const meals = (plan?.meals || []).filter((m) => m.day === todayStr);
    if (meals.length === 0) {
      return `${header}\n\nAucun repas n'est prévu à préparer aujourd'hui (peut-être CROUS, resto, ou chez les parents).`;
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
    return `${header}\n\nLE MENU PRÉVU AUJOURD'HUI :\n${block}`;
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

  const detailFor = (e: EventItem): string | null =>
    agent === "jannik" ? workoutDetail(plan, e) : e.description ? `  ${e.description}` : null;

  if (current) {
    let line = `EN CE MOMENT : ${eventLine(current)}`;
    const d = detailFor(current);
    if (d) line += `\n${d}`;
    parts.push(line);
  } else if (next) {
    let line = `PROCHAINEMENT AUJOURD'HUI : ${eventLine(next)}`;
    const d = detailFor(next);
    if (d) line += `\n${d}`;
    parts.push(line);
  }

  if (todays.length > 0) {
    const label =
      agent === "josiane" ? "L'EMPLOI DU TEMPS D'AUJOURD'HUI" : "DANS TON DOMAINE AUJOURD'HUI";
    parts.push(`${label} :\n${todays.map((e) => `- ${eventLine(e)}`).join("\n")}`);
  } else {
    parts.push("(rien de prévu dans ton domaine aujourd'hui)");
  }

  if (agent === "josiane" && plan?.warnings?.length) {
    parts.push(`POINTS DE VIGILANCE DU PLAN :\n${plan.warnings.map((w) => `- ${w}`).join("\n")}`);
  }

  return parts.join("\n\n");
}

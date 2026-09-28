/**
 * Accord entre le plan STOCKÉ d'une semaine (data/plans.json) et ce que
 * l'agenda montre VRAIMENT (événements source "plan").
 *
 * Le plan stocké est la base de toute retouche de Josiane (edit_plan_sessions,
 * replan_week) : elle opère dessus puis réécrit la semaine. Or les retouches à
 * la main (glisser un bloc, changer une heure dans la fiche, supprimer une
 * séance) ne modifient que l'événement. Sans cet accord, la retouche suivante
 * de Josiane repartait du plan d'origine et effaçait tout ce qui avait été
 * fait à la main (vécu).
 *
 * Règle : l'AGENDA FAIT FOI. Avant d'opérer, le plan est recalé sur les
 * événements ; à l'écriture, les événements existants sont mis à jour en place
 * (même id : checklist, rappel et notes survivent) au lieu d'être recréés.
 *
 * Module pur (aucun accès disque) : commit.ts l'applique au stockage.
 */

import type { EventItem, PlannedSession, WeekPlan } from "./types";

/**
 * Façons d'apparier une séance à un événement, essayées dans l'ordre donné :
 *  - "id"     : l'événement porte le planSessionId de la séance ;
 *  - "idKind" : idem, et même catégorie (un id resservi par une résolution
 *               neuve ne transforme pas un bloc Monumia en Delos) ;
 *  - "slot"   : même créneau et même titre (événements d'avant le lien) ;
 *  - "near"   : même titre et même catégorie, créneau le plus proche —
 *               un événement d'avant le lien, déplacé à la main.
 */
export type MatchStrategy = "id" | "idKind" | "slot" | "near";

const minutes = (iso: string) => Date.parse(iso) / 60000;

/**
 * Apparie chaque séance à au plus un événement (et réciproquement). Renvoie
 * un tableau aligné sur `sessions`.
 */
export function matchSessionsToEvents(
  sessions: PlannedSession[],
  events: EventItem[],
  strategies: MatchStrategy[]
): (EventItem | undefined)[] {
  const out: (EventItem | undefined)[] = sessions.map(() => undefined);
  const used = new Set<string>();

  for (const strategy of strategies) {
    sessions.forEach((s, i) => {
      if (out[i]) return;
      const free = events.filter((e) => !used.has(e.id));
      let hit: EventItem | undefined;
      if (strategy === "id" || strategy === "idKind") {
        hit = free.find(
          (e) =>
            Boolean(s.id) &&
            e.planSessionId === s.id &&
            (strategy === "id" || (e.category || "") === (s.category || ""))
        );
      } else if (strategy === "slot") {
        hit = free.find((e) => e.start === s.start && e.end === s.end && e.title === s.title);
      } else {
        hit = free
          .filter(
            (e) =>
              !e.planSessionId &&
              e.title === s.title &&
              (e.category || "") === (s.category || "")
          )
          .sort(
            (a, b) =>
              Math.abs(minutes(a.start) - minutes(s.start)) -
              Math.abs(minutes(b.start) - minutes(s.start))
          )[0];
      }
      if (hit) {
        out[i] = hit;
        used.add(hit.id);
      }
    });
  }
  return out;
}

/**
 * Donne un id unique à chaque séance. Les ids manquants reprennent la
 * convention `r<n>` de la retouche (ce sont ceux que Josiane a déjà vus) ; un
 * doublon reçoit un suffixe.
 */
export function withUniqueSessionIds(sessions: PlannedSession[]): PlannedSession[] {
  const seen = new Set<string>();
  return sessions.map((s, i) => {
    const base = s.id || `r${i + 1}`;
    let id = base;
    for (let n = 2; seen.has(id); n++) id = `${base}-${n}`;
    seen.add(id);
    return id === s.id ? s : { ...s, id };
  });
}

export type PlanSyncResult = {
  /** Le plan recalé sur l'agenda. */
  plan: WeekPlan;
  /** Le plan stocké différait de l'agenda (à réenregistrer). */
  changed: boolean;
  /** Événements à qui il faut écrire leur planSessionId (lien manquant ou faux). */
  links: { eventId: string; sessionId: string }[];
  /** Ce qui a bougé à la main, en clair (trace, et message à Josiane). */
  notes: string[];
};

/**
 * Recale le plan stocké sur les événements « plan » de sa semaine :
 *  - séance dont l'événement a bougé / été renommé / recatégorisé → la séance
 *    prend les valeurs de l'événement ;
 *  - séance dont l'événement a disparu → supprimée à la main, elle sort du plan ;
 *  - événement « plan » sans séance → gardé, il entre dans le plan.
 *
 * `resolvePlace` rattache un lieu tapé à la main à un lieu de la config (les
 * trajets en dépendent).
 */
export function syncPlanWithAgenda(
  plan: WeekPlan,
  weekEvents: EventItem[],
  resolvePlace: (location?: string) => string | undefined = () => undefined
): PlanSyncResult {
  const events = weekEvents.filter((e) => e.source === "plan");
  const base = withUniqueSessionIds(Array.isArray(plan.sessions) ? plan.sessions : []);
  let changed = base.some((s, i) => s !== plan.sessions[i]);
  const matched = matchSessionsToEvents(base, events, ["id", "slot", "near"]);
  const links: PlanSyncResult["links"] = [];
  const notes: string[] = [];
  const hm = (iso: string) => iso.slice(11, 16);

  const sessions: PlannedSession[] = [];
  base.forEach((s, i) => {
    const ev = matched[i];
    if (!ev) {
      changed = true;
      notes.push(`« ${s.title} » du ${s.start.slice(0, 10)} ${hm(s.start)} supprimée à la main`);
      return;
    }
    if (ev.planSessionId !== s.id) links.push({ eventId: ev.id, sessionId: s.id! });
    const location = ev.location || undefined;
    const placeMoved = location !== (s.placeName || undefined);
    const next: PlannedSession = {
      ...s,
      title: ev.title,
      start: ev.start,
      end: ev.end,
      category: ev.category || s.category,
      ...(placeMoved ? { placeName: location, placeId: resolvePlace(location) } : {}),
    };
    if (
      next.title !== s.title ||
      next.start !== s.start ||
      next.end !== s.end ||
      next.category !== s.category ||
      placeMoved
    ) {
      changed = true;
      notes.push(
        `« ${s.title} » ${s.start.slice(0, 10)} ${hm(s.start)}-${hm(s.end)} → ` +
          `« ${next.title} » ${next.start.slice(0, 10)} ${hm(next.start)}-${hm(next.end)}`
      );
    }
    sessions.push(next);
  });

  const usedIds = new Set(sessions.map((s) => s.id));
  const claimed = new Set(matched.filter(Boolean).map((e) => e!.id));
  for (const ev of events) {
    if (claimed.has(ev.id)) continue;
    let id = `m-${ev.id}`;
    for (let n = 2; usedIds.has(id); n++) id = `m-${ev.id}-${n}`;
    usedIds.add(id);
    sessions.push({
      id,
      title: ev.title,
      start: ev.start,
      end: ev.end,
      category: ev.category,
      placeName: ev.location || undefined,
      placeId: resolvePlace(ev.location),
    });
    links.push({ eventId: ev.id, sessionId: id });
    changed = true;
    notes.push(`« ${ev.title} » ${ev.start.slice(0, 10)} ${hm(ev.start)} ajoutée au plan`);
  }

  sessions.sort((a, b) => a.start.localeCompare(b.start));
  return { plan: { ...plan, sessions }, changed, links, notes };
}

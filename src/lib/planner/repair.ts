/**
 * Réparations MÉCANIQUES — dernier filet après les re-prompts de Josiane.
 *
 * Uniquement des corrections sûres et déterministes :
 *  1. recaler une séance de sport dans les heures d'ouverture de son lieu
 *     (en gardant sa durée) ;
 *  2. écourter à la fin de journée normale un bloc de travail qui déborde
 *     sans être marqué exceptionnel (si ce qui reste vaut la peine) ;
 *  3. supprimer une session qui chevauche encore un événement fixe ou une
 *     autre session (la plus tardive des deux saute).
 *
 * Tout le reste (quotas, trajets, déjeuner…) n'est PAS réparable à l'aveugle :
 * ça reste en violation et sera remonté en warning honnête.
 */

import type { LifeConfig } from "./config";
import { travelMinutes } from "./config";
import { MIDDAY } from "./guardrails";
import type { FixedItem, PlanSession } from "./types";

/** Durée minimale (min) pour qu'un bloc écourté vaille encore la peine. */
const MIN_CLIPPED_MIN = 45;

function hhmm(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

function minOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

function setTime(iso: string, minutes: number): string {
  const day = iso.slice(0, 10);
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${day}T${h}:${m}:00`;
}

export type RepairLog = { sessionId: string; action: string };

/** 1. Recale les séances de sport dans les heures d'ouverture (durée conservée). */
function fixOpeningHours(
  cfg: LifeConfig,
  sessions: PlanSession[],
  log: RepairLog[]
): PlanSession[] {
  const byId = new Map(cfg.sport.activities.map((a) => [a.id, a]));
  return sessions.map((s) => {
    if (s.category !== "sport" || !s.activityId) return s;
    const act = byId.get(s.activityId);
    if (!act?.openingHours) return s;
    const open = hhmm(act.openingHours.open);
    const close = hhmm(act.openingHours.close);
    if (close <= open) return s;

    let start = minOfDay(s.start);
    let end = minOfDay(s.end);
    const dur = end - start;
    if (dur <= 0 || (start >= open && end <= close)) return s;

    if (dur >= close - open) {
      start = open;
      end = close;
    } else if (start < open) {
      start = open;
      end = start + dur;
    } else {
      end = close;
      start = end - dur;
    }
    log.push({ sessionId: s.id, action: `recalée dans les heures d'ouverture (${act.openingHours.open}-${act.openingHours.close})` });
    return { ...s, start: setTime(s.start, start), end: setTime(s.end, end) };
  });
}

/** Catégories de travail écourtables en fin de journée. */
const CLIPPABLE = new Set(["monumia", "autre"]);

/** 2. Écourte à normalEnd le travail non exceptionnel qui déborde. */
function clipLateWork(
  cfg: LifeConfig,
  sessions: PlanSession[],
  log: RepairLog[]
): PlanSession[] {
  const normalEnd = hhmm(cfg.schedule.normalEnd);
  return sessions.flatMap((s) => {
    if (s.exceptional || !CLIPPABLE.has(s.category)) return [s];
    const end = minOfDay(s.end);
    if (end <= normalEnd) return [s];
    const start = minOfDay(s.start);
    if (normalEnd - start < MIN_CLIPPED_MIN) {
      log.push({ sessionId: s.id, action: "supprimée (débordait la fin de journée, trop courte une fois écourtée)" });
      return [];
    }
    log.push({ sessionId: s.id, action: `écourtée à ${cfg.schedule.normalEnd}` });
    return [{ ...s, end: setTime(s.end, normalEnd) }];
  });
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Importance d'une session quand il faut trancher un chevauchement résiduel :
 * une sortie DEMANDÉE par l'utilisateur vaut plus qu'un Delos (replaçable),
 * qui vaut plus que le sport, qui vaut plus que Monumia — Monumia est la
 * variable d'ajustement, c'est toujours lui qui saute en premier.
 */
const DROP_PRIORITY: Record<PlanSession["category"], number> = {
  sortie: 5,
  delos: 4,
  sport: 3,
  autre: 2,
  repas: 1,
  monumia: 0,
  // Les trajets n'atteignent jamais la réparation (générés après le verdict,
  // hors pipeline LLM) — clé présente pour la complétude du type.
  trajet: 1,
};

/** 3. Supprime les sessions qui chevauchent encore du fixe ou entre elles —
 *     en sacrifiant les MOINS importantes, jamais l'inverse. */
function dropOverlaps(
  sessions: PlanSession[],
  fixed: FixedItem[],
  log: RepairLog[]
): PlanSession[] {
  // Les plus importantes réservent leur créneau en premier.
  const byImportance = [...sessions].sort(
    (a, b) =>
      DROP_PRIORITY[b.category] - DROP_PRIORITY[a.category] ||
      a.start.localeCompare(b.start)
  );
  const kept: PlanSession[] = [];
  for (const s of byImportance) {
    const hitsFixed = fixed.some((f) => overlaps(s.start, s.end, f.start, f.end));
    const hitsKept = kept.some((k) => overlaps(s.start, s.end, k.start, k.end));
    if (hitsFixed || hitsKept) {
      log.push({
        sessionId: s.id,
        action: hitsFixed
          ? "supprimée (chevauchait un événement fixe)"
          : "supprimée (chevauchait une session plus importante)",
      });
      continue;
    }
    kept.push(s);
  }
  return kept.sort((a, b) => a.start.localeCompare(b.start));
}

/** Catégories de travail écourables/décalables pour absorber un trajet. */
const WORK_SET = new Set(["delos", "monumia", "autre"]);

function overlapMin(aS: number, aE: number, bS: number, bE: number): number {
  return Math.max(0, Math.min(aE, bE) - Math.max(aS, bS));
}

/**
 * 4. Trajets trop courts : écourte (ou décale) le bloc de TRAVAIL adjacent
 * pour dégager trajet + déjeuner + transition sport. C'est le correctif
 * déterministe du « 30 min entre Monumia et le cours » que le modèle
 * n'arrive pas à corriger tout seul.
 */
function fixTravelGaps(
  cfg: LifeConfig,
  sessions: PlanSession[],
  fixed: FixedItem[],
  log: RepairLog[]
): PlanSession[] {
  const minBlock = cfg.work.minBlockMinutes;
  const removed = new Set<string>();

  type It = {
    start: string;
    end: string;
    placeId?: string;
    session?: PlanSession;
  };
  const items: It[] = [
    ...sessions.map((s) => ({ start: s.start, end: s.end, placeId: s.placeId, session: s })),
    ...fixed.map((f) => ({ start: f.start, end: f.end, placeId: f.placeId })),
  ].sort((a, b) => a.start.localeCompare(b.start));

  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const next = items[i];
    if (prev.session && removed.has(prev.session.id)) continue;
    if (next.session && removed.has(next.session.id)) continue;
    if (prev.start.slice(0, 10) !== next.start.slice(0, 10)) continue;
    if (!prev.placeId || !next.placeId || prev.placeId === next.placeId) continue;
    const t = travelMinutes(cfg, prev.placeId, next.placeId);
    if (!t) continue;

    const gapStart = minOfDay(prev.end);
    const gapEnd = minOfDay(next.start);
    const gap = gapEnd - gapStart;
    if (gap < 0) continue; // chevauchement : géré par dropOverlaps

    let required = t.minutes;
    if (overlapMin(gapStart, gapEnd, MIDDAY.start, MIDDAY.end) > 0)
      required += cfg.schedule.lunchBreak.minMinutes;
    if (prev.session?.category === "sport") required += cfg.sport.bufferAfterMin;
    if (gap >= required) continue;

    if (prev.session && WORK_SET.has(prev.session.category)) {
      const newEnd = gapEnd - required;
      if (newEnd - minOfDay(prev.session.start) >= minBlock) {
        prev.session.end = setTime(prev.session.end, newEnd);
        prev.end = prev.session.end;
        log.push({
          sessionId: prev.session.id,
          action: `écourtée à ${prev.session.end.slice(11, 16)} pour dégager le trajet (+ déjeuner/transition)`,
        });
      } else {
        removed.add(prev.session.id);
        log.push({ sessionId: prev.session.id, action: "supprimée (impossible de dégager le trajet en l'écourtant)" });
      }
    } else if (next.session && WORK_SET.has(next.session.category)) {
      const newStart = gapStart + required;
      if (minOfDay(next.session.end) - newStart >= minBlock) {
        next.session.start = setTime(next.session.start, newStart);
        next.start = next.session.start;
        log.push({
          sessionId: next.session.id,
          action: `décalée à ${next.session.start.slice(11, 16)} pour dégager le trajet (+ déjeuner/transition)`,
        });
      } else {
        removed.add(next.session.id);
        log.push({ sessionId: next.session.id, action: "supprimée (impossible de dégager le trajet en la décalant)" });
      }
    }
  }

  return sessions.filter((s) => !removed.has(s.id));
}

/**
 * Applique les réparations dans l'ordre. Renvoie les sessions réparées
 * et le journal des actions (à transformer en warnings pour l'utilisateur).
 */
export function mechanicalRepair(
  cfg: LifeConfig,
  sessions: PlanSession[],
  fixed: FixedItem[]
): { sessions: PlanSession[]; log: RepairLog[] } {
  const log: RepairLog[] = [];
  let out = fixOpeningHours(cfg, sessions, log);
  out = clipLateWork(cfg, out, log);
  out = dropOverlaps(out, fixed, log);
  out = fixTravelGaps(cfg, out, fixed, log);
  out.sort((a, b) => a.start.localeCompare(b.start));
  return { sessions: out, log };
}

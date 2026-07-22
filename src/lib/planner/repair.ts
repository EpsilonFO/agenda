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

/** 3. Supprime les sessions qui chevauchent encore du fixe ou entre elles. */
function dropOverlaps(
  sessions: PlanSession[],
  fixed: FixedItem[],
  log: RepairLog[]
): PlanSession[] {
  const kept: PlanSession[] = [];
  const sorted = [...sessions].sort((a, b) => a.start.localeCompare(b.start));
  for (const s of sorted) {
    const hitsFixed = fixed.some((f) => overlaps(s.start, s.end, f.start, f.end));
    const hitsKept = kept.some((k) => overlaps(s.start, s.end, k.start, k.end));
    if (hitsFixed || hitsKept) {
      log.push({
        sessionId: s.id,
        action: hitsFixed
          ? "supprimée (chevauchait un événement fixe)"
          : "supprimée (chevauchait une autre session)",
      });
      continue;
    }
    kept.push(s);
  }
  return kept;
}

/**
 * Applique les trois réparations dans l'ordre. Renvoie les sessions réparées
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
  out.sort((a, b) => a.start.localeCompare(b.start));
  return { sessions: out, log };
}

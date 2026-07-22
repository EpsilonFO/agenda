/**
 * Les GUARDRAILS — le déterminisme du planificateur v2.
 *
 * Josiane (LLM) place les créneaux avec de la variété ; ces fonctions PURES
 * vérifient son planning contre la config de vie et les événements fixes.
 * Aucun LLM ici : même entrée → mêmes violations, toutes testées unitairement.
 *
 * Sémantique des gravités :
 *  - "error" → la boucle de réparation DOIT corriger (re-prompt ciblé, puis
 *    réparation mécanique) ;
 *  - "warn"  → simplement remonté à l'utilisateur.
 *
 * Choix notables :
 *  - Le trajet requis entre deux activités vient de travelMinutes(), qui
 *    respecte les modes interdits par lieu — l'interdiction de la voiture
 *    pour Delos est donc appliquée ici, sans règle séparée.
 *  - Les bornes de la journée sont LIBRES (commencer à 11h, finir à 18h) :
 *    on ne vérifie que les trous ENTRE activités, pas le remplissage.
 *  - Un trou n'existe qu'entre deux blocs COMPACTABLES (travail, cours,
 *    sport) : l'après-midi libre avant une sortie n'est pas un trou, c'est
 *    du temps à soi.
 *  - Fin de journée : normalEnd s'applique au travail et au sport ; les
 *    sorties et repas en sont exempts (un dîner ou une soirée peut finir tard).
 */

import type { LifeConfig, SportActivity } from "./config";
import { placeById, travelMinutes } from "./config";
import type { FixedItem, PlanSession, Violation } from "./types";

/* ----------------------------- Helpers temps ------------------------- */

const WEEKDAYS = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
] as const;

function toDate(iso: string): Date {
  return new Date(iso);
}

/** Minutes depuis minuit d'un ISO local. */
function minOfDay(iso: string): number {
  const d = toDate(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/** "HH:MM" → minutes depuis minuit. */
function hhmm(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function weekdayOf(iso: string): string {
  return WEEKDAYS[toDate(iso).getDay()];
}

function durationMin(s: { start: string; end: string }): number {
  return Math.round((toDate(s.end).getTime() - toDate(s.start).getTime()) / 60000);
}

function fmt(iso: string): string {
  return `${weekdayOf(iso)} ${iso.slice(11, 16)}`;
}

/** Chevauchement en minutes entre [aStart,aEnd] et [bStart,bEnd] (minutes du jour). */
function overlapMin(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/* --------------------------- Modèle interne -------------------------- */

/** Session ou événement fixe, unifiés pour les règles temporelles. */
type Item = {
  id: string;
  title: string;
  start: string;
  end: string;
  placeId?: string;
  fixed: boolean;
  session?: PlanSession;
};

function toItems(sessions: PlanSession[], fixed: FixedItem[]): Item[] {
  return [
    ...sessions.map((s) => ({
      id: s.id,
      title: s.title,
      start: s.start,
      end: s.end,
      placeId: s.placeId,
      fixed: false,
      session: s,
    })),
    ...fixed.map((f) => ({
      id: f.id,
      title: f.title,
      start: f.start,
      end: f.end,
      placeId: f.placeId,
      fixed: true,
    })),
  ].sort((a, b) => a.start.localeCompare(b.start));
}

function byDay(items: Item[]): Map<string, Item[]> {
  const map = new Map<string, Item[]>();
  for (const it of items) {
    const key = dayKey(it.start);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(it);
  }
  return map;
}

/* ------------------------------- Règles ------------------------------ */

type Ctx = {
  cfg: LifeConfig;
  sessions: PlanSession[];
  fixed: FixedItem[];
  items: Item[];
  days: Map<string, Item[]>;
  out: Violation[];
};

function push(
  ctx: Ctx,
  rule: Violation["rule"],
  severity: Violation["severity"],
  message: string,
  sessionIds: string[] = []
): void {
  ctx.out.push({ rule, severity, message, sessionIds });
}

/** overlap-fixed / overlap-internal : aucun chevauchement. */
function checkOverlaps(ctx: Ctx): void {
  const items = ctx.items;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (b.start >= a.end) break; // triés par start
      if (a.fixed && b.fixed) continue; // l'existant ne nous regarde pas
      const ids = [a, b].filter((x) => !x.fixed).map((x) => x.id);
      if (a.fixed || b.fixed) {
        push(
          ctx,
          "overlap-fixed",
          "error",
          `« ${a.title} » et « ${b.title} » se chevauchent (${fmt(b.start)}) — l'événement fixe est intouchable.`,
          ids
        );
      } else {
        push(
          ctx,
          "overlap-internal",
          "error",
          `« ${a.title} » et « ${b.title} » se chevauchent (${fmt(b.start)}).`,
          ids
        );
      }
    }
  }
}

/** travel-time : écart ≥ trajet requis entre lieux (modes interdits respectés). */
function checkTravel(ctx: Ctx): void {
  for (const items of ctx.days.values()) {
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1];
      const next = items[i];
      if (!prev.placeId || !next.placeId) continue;
      if (prev.placeId === next.placeId) continue;
      const t = travelMinutes(ctx.cfg, prev.placeId, next.placeId);
      if (!t) continue;
      const gap = minOfDay(next.start) - minOfDay(prev.end);
      if (gap < t.minutes) {
        const from = placeById(ctx.cfg, prev.placeId)?.name || prev.placeId;
        const to = placeById(ctx.cfg, next.placeId)?.name || next.placeId;
        push(
          ctx,
          "travel-time",
          "error",
          `${fmt(next.start)} : ${gap} min entre « ${prev.title} » (${from}) et « ${next.title} » (${to}), il faut ≥ ${t.minutes} min (${t.mode}).`,
          [prev, next].filter((x) => !x.fixed).map((x) => x.id)
        );
      }
    }
  }
}

/** cluster-pingpong : pas de Paris→Orsay→Paris dans la même journée. */
function checkPingpong(ctx: Ctx): void {
  for (const [day, items] of ctx.days) {
    const clusters: string[] = [];
    for (const it of items) {
      const c = placeById(ctx.cfg, it.placeId)?.cluster;
      if (c && clusters[clusters.length - 1] !== c) clusters.push(c);
    }
    const revisited = clusters.some((c, i) => clusters.indexOf(c) < i && clusters[i - 1] !== c);
    if (clusters.length >= 3 && revisited) {
      push(
        ctx,
        "cluster-pingpong",
        "error",
        `${weekdayOf(items[0].start)} ${day} : aller-retour entre clusters dans la même journée (${clusters.join(" → ")}) — regrouper les activités par zone.`,
        items.filter((x) => !x.fixed).map((x) => x.id)
      );
    }
  }
}

/** Catégories soumises à la fin de journée normale (les sorties/repas en sont exemptes). */
const BOUNDED_CATEGORIES = new Set(["delos", "monumia", "sport", "autre"]);

/** bounds-* : jamais avant dayStart ; travail/sport jamais après normalEnd sauf exceptionnel. */
function checkBounds(ctx: Ctx): void {
  const { schedule } = ctx.cfg;
  const dayStart = hhmm(schedule.dayStart);
  const normalEnd = hhmm(schedule.normalEnd);
  const exceptionalEnd = hhmm(schedule.exceptionalEnd);
  let exceptionalCount = 0;

  for (const s of ctx.sessions) {
    if (minOfDay(s.start) < dayStart) {
      push(
        ctx,
        "bounds-start",
        "error",
        `« ${s.title} » commence à ${s.start.slice(11, 16)} (${weekdayOf(s.start)}) — rien avant ${schedule.dayStart}.`,
        [s.id]
      );
    }
    if (!BOUNDED_CATEGORIES.has(s.category)) continue;
    const end = minOfDay(s.end);
    if (end > normalEnd) {
      if (s.exceptional) {
        exceptionalCount++;
        if (end > exceptionalEnd) {
          push(
            ctx,
            "bounds-end",
            "error",
            `« ${s.title} » finit à ${s.end.slice(11, 16)}, après la limite absolue ${schedule.exceptionalEnd}.`,
            [s.id]
          );
        }
      } else {
        push(
          ctx,
          "bounds-end",
          "error",
          `« ${s.title} » finit à ${s.end.slice(11, 16)} (${weekdayOf(s.end)}), après ${schedule.normalEnd} — à marquer exceptionnelle (et justifier) ou à recaler.`,
          [s.id]
        );
      }
    }
  }

  if (exceptionalCount > schedule.maxExceptionalPerWeek) {
    push(
      ctx,
      "bounds-exceptional-count",
      "error",
      `${exceptionalCount} sessions finissent après ${schedule.normalEnd} cette semaine (max ${schedule.maxExceptionalPerWeek}) — l'exceptionnel doit rester rare.`
    );
  }
}

/**
 * Plage structurelle du midi : « manger le midi » se joue autour de midi,
 * ce n'est pas une préférence configurable (la config ne fixe que les durées).
 */
const MIDDAY = { start: 11 * 60 + 30, end: 14 * 60 + 30 };

/** lunch-break : chaque jour, un bloc libre CONTIGU ≥ minMinutes autour de midi. */
function checkLunch(ctx: Ctx): void {
  const { lunchBreak } = ctx.cfg.schedule;

  for (const [day, items] of ctx.days) {
    // Intervalles occupés dans la plage du midi (les repas ne bloquent pas).
    const busy: Array<[number, number]> = [];
    const covering: Item[] = [];
    for (const it of items) {
      if (it.session?.category === "repas") continue;
      const s = Math.max(minOfDay(it.start), MIDDAY.start);
      const e = Math.min(minOfDay(it.end), MIDDAY.end);
      if (e > s) {
        busy.push([s, e]);
        covering.push(it);
      }
    }
    busy.sort((a, b) => a[0] - b[0]);

    // Plus grand trou libre contigu dans la plage.
    let cursor = MIDDAY.start;
    let maxFree = 0;
    for (const [s, e] of busy) {
      maxFree = Math.max(maxFree, s - cursor);
      cursor = Math.max(cursor, e);
    }
    maxFree = Math.max(maxFree, MIDDAY.end - cursor);

    if (maxFree < lunchBreak.minMinutes) {
      push(
        ctx,
        "lunch-break",
        "error",
        `${weekdayOf(items[0].start)} ${day} : aucun créneau libre de ${lunchBreak.minMinutes} min autour de midi pour déjeuner (plus grand créneau : ${maxFree} min).`,
        covering.filter((x) => !x.fixed).map((x) => x.id)
      );
    }
  }
}

/** Un bloc « compactable » participe à la densité de la journée de travail.
 *  Les sorties et repas n'en font pas partie : du temps libre avant une
 *  soirée n'est pas un trou. */
function isCompactable(it: Item): boolean {
  if (it.fixed) return true; // cours, rdv fixés
  const c = it.session!.category;
  return c === "delos" || c === "monumia" || c === "sport" || c === "autre";
}

/** big-hole : pas de trou > maxHoleMinutes ENTRE deux blocs compactables (trajet et déjeuner déduits). */
function checkHoles(ctx: Ctx): void {
  const { schedule } = ctx.cfg;
  const winStart = MIDDAY.start;
  const winEnd = MIDDAY.end;

  for (const items of ctx.days.values()) {
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1];
      const next = items[i];
      if (!isCompactable(prev) || !isCompactable(next)) continue;
      const gapStart = minOfDay(prev.end);
      const gapEnd = minOfDay(next.start);
      let gap = gapEnd - gapStart;
      if (gap <= 0) continue;
      // Déduire le trajet requis…
      if (prev.placeId && next.placeId && prev.placeId !== next.placeId) {
        const t = travelMinutes(ctx.cfg, prev.placeId, next.placeId);
        if (t) gap -= t.minutes;
      }
      // …et le crédit déjeuner si le trou touche la fenêtre.
      gap -= Math.min(
        overlapMin(gapStart, gapEnd, winStart, winEnd),
        schedule.lunchBreak.idealMinutes
      );
      if (gap > schedule.maxHoleMinutes) {
        push(
          ctx,
          "big-hole",
          "warn",
          `${fmt(prev.end)}→${next.start.slice(11, 16)} : ~${gap} min de trou entre « ${prev.title} » et « ${next.title} » (max ${schedule.maxHoleMinutes} min).`,
          [prev, next].filter((x) => !x.fixed).map((x) => x.id)
        );
      }
    }
  }
}

/** delos-quota / delos-window : 3 demi-journées, posées dans les gabarits. */
function checkDelos(ctx: Ctx): void {
  const { delos } = ctx.cfg.work;
  const sessions = ctx.sessions.filter((s) => s.category === "delos");

  if (sessions.length < delos.halfDaysPerWeek) {
    push(
      ctx,
      "delos-quota",
      "error",
      `${sessions.length} demi-journée(s) Delos posée(s) sur ${delos.halfDaysPerWeek} attendues.`
    );
  } else if (sessions.length > delos.halfDaysPerWeek) {
    push(
      ctx,
      "delos-quota",
      "warn",
      `${sessions.length} demi-journées Delos posées — ${delos.halfDaysPerWeek} suffisent, pas besoin de faire plus.`
    );
  }

  for (const s of sessions) {
    const sMin = minOfDay(s.start);
    const eMin = minOfDay(s.end);
    const fits = delos.halfDayWindows.some(
      (w) => sMin >= hhmm(w.start) && eMin <= hhmm(w.end)
    );
    if (!fits) {
      push(
        ctx,
        "delos-window",
        "warn",
        `« ${s.title} » (${fmt(s.start)}–${s.end.slice(11, 16)}) sort des gabarits de demi-journée Delos (${delos.halfDayWindows
          .map((w) => `${w.start}-${w.end}`)
          .join(", ")}).`,
        [s.id]
      );
    }
  }
}

/** monumia-min / monumia-daily-max : plancher hebdo et plafond quotidien. */
function checkMonumia(ctx: Ctx): void {
  const { monumia } = ctx.cfg.work;
  const sessions = ctx.sessions.filter((s) => s.category === "monumia");

  const totalH = sessions.reduce((acc, s) => acc + durationMin(s), 0) / 60;
  if (totalH < monumia.minHoursPerWeek) {
    push(
      ctx,
      "monumia-min",
      "error",
      `${totalH.toFixed(1)}h de Monumia dans la semaine — minimum ${monumia.minHoursPerWeek}h.`
    );
  }

  const perDay = new Map<string, number>();
  for (const s of sessions) {
    const key = dayKey(s.start);
    perDay.set(key, (perDay.get(key) || 0) + durationMin(s));
  }
  for (const [day, minutes] of perDay) {
    if (minutes / 60 > monumia.maxHoursPerDay) {
      push(
        ctx,
        "monumia-daily-max",
        "error",
        `${day} : ${(minutes / 60).toFixed(1)}h de Monumia sur une journée (max ${monumia.maxHoursPerDay}h).`,
        sessions.filter((s) => dayKey(s.start) === day).map((s) => s.id)
      );
    }
  }
}

/** sport-* : quotas, récupération, heures d'ouverture, créneau imposé. */
function checkSport(ctx: Ctx): void {
  const { sport } = ctx.cfg;
  const sessions = ctx.sessions
    .filter((s) => s.category === "sport")
    .sort((a, b) => a.start.localeCompare(b.start));

  if (sessions.length < sport.sessionsPerWeekMin) {
    push(
      ctx,
      "sport-quota",
      "warn",
      `${sessions.length} séance(s) de sport sur ${sport.sessionsPerWeekMin}-${sport.sessionsPerWeekMax} visées.`
    );
  } else if (sessions.length > sport.sessionsPerWeekMax) {
    push(
      ctx,
      "sport-quota",
      "warn",
      `${sessions.length} séances de sport — le max est ${sport.sessionsPerWeekMax}.`
    );
  }

  const activityOf = (s: PlanSession): SportActivity | undefined =>
    ctx.cfg.sport.activities.find((a) => a.id === s.activityId);

  // Récupération : entre deux séances de la MÊME activité.
  const byActivity = new Map<string, PlanSession[]>();
  for (const s of sessions) {
    if (!s.activityId) continue;
    if (!byActivity.has(s.activityId)) byActivity.set(s.activityId, []);
    byActivity.get(s.activityId)!.push(s);
  }
  for (const [actId, list] of byActivity) {
    const act = ctx.cfg.sport.activities.find((a) => a.id === actId);
    if (!act) continue;
    for (let i = 1; i < list.length; i++) {
      const restH =
        (toDate(list[i].start).getTime() - toDate(list[i - 1].end).getTime()) / 3600000;
      if (restH < act.minRestHours) {
        push(
          ctx,
          "sport-recovery",
          "error",
          `${act.name} : ${restH.toFixed(0)}h de repos entre ${fmt(list[i - 1].start)} et ${fmt(list[i].start)} — minimum ${act.minRestHours}h.`,
          [list[i - 1].id, list[i].id]
        );
      }
    }
  }

  for (const s of sessions) {
    const act = activityOf(s);
    if (!act) continue;

    if (act.openingHours) {
      const open = hhmm(act.openingHours.open);
      const close = hhmm(act.openingHours.close);
      if (minOfDay(s.start) < open || minOfDay(s.end) > close) {
        push(
          ctx,
          "sport-opening-hours",
          "error",
          `« ${s.title} » (${fmt(s.start)}–${s.end.slice(11, 16)}) sort des heures d'ouverture (${act.openingHours.open}–${act.openingHours.close}).`,
          [s.id]
        );
      }
    }

    if (act.fixedSlot) {
      const ok =
        weekdayOf(s.start) === act.fixedSlot.weekday &&
        s.start.slice(11, 16) === act.fixedSlot.start &&
        s.end.slice(11, 16) === act.fixedSlot.end;
      if (!ok) {
        push(
          ctx,
          "sport-fixed-slot",
          "error",
          `${act.name} a un créneau imposé (${act.fixedSlot.weekday} ${act.fixedSlot.start}-${act.fixedSlot.end}) — « ${s.title} » est posée ${fmt(s.start)}.`,
          [s.id]
        );
      }
    }
  }
}

/** sorties-quota : le minimum de sorties avec Marine est une contrainte. */
function checkSorties(ctx: Ctx): void {
  const { copine } = ctx.cfg.sorties;
  const count = ctx.sessions.filter((s) => s.category === "sortie").length;
  if (count < copine.perWeekMin) {
    push(
      ctx,
      "sorties-quota",
      "error",
      `${count} sortie(s) posée(s) — minimum ${copine.perWeekMin} par semaine avec ${copine.name}, à toujours caser.`
    );
  }
}

/* ------------------------------ Entrée ------------------------------- */

/**
 * Vérifie un plan de semaine complet. `fixed` = les événements déjà dans
 * l'agenda pour la même semaine (cours, rdv manuels).
 */
export function checkWeekPlan(
  cfg: LifeConfig,
  sessions: PlanSession[],
  fixed: FixedItem[]
): Violation[] {
  const items = toItems(sessions, fixed);
  const ctx: Ctx = { cfg, sessions, fixed, items, days: byDay(items), out: [] };

  checkOverlaps(ctx);
  checkTravel(ctx);
  checkPingpong(ctx);
  checkBounds(ctx);
  checkLunch(ctx);
  checkHoles(ctx);
  checkDelos(ctx);
  checkMonumia(ctx);
  checkSport(ctx);
  checkSorties(ctx);

  // Les erreurs d'abord (pour la boucle de réparation), puis les warns.
  return ctx.out.sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1
  );
}

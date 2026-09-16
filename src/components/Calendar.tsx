"use client";

import { useEffect, useRef, useState } from "react";
import { ChecklistItem, EventItem } from "@/lib/types";
import {
  addDays,
  formatTime,
  parseIso,
  sameDay,
  weekdayShort,
} from "@/lib/dates";

const DAY_START = 7; // 7h
const DAY_END = 24; // minuit
const HOUR_PX = 56;
const EVENT_BASE = "#101d31"; // fond opaque de l'agenda
const SNAP_MIN = 15; // magnétisme au quart d'heure
const SLOT_PX = HOUR_PX / (60 / SNAP_MIN); // hauteur d'un quart d'heure

/** Arrondit des minutes de journée au quart d'heure le plus proche, borné à la grille. */
function snapMin(min: number): number {
  const m = Math.round(min / SNAP_MIN) * SNAP_MIN;
  return Math.min(Math.max(m, DAY_START * 60), DAY_END * 60);
}

/** Quart d'heure contenant le pointeur (arrondi inférieur), borné à la grille. */
function floorSnapMin(min: number): number {
  const m = Math.floor(min / SNAP_MIN) * SNAP_MIN;
  return Math.min(Math.max(m, DAY_START * 60), DAY_END * 60 - SNAP_MIN);
}

/** Minutes de journée (début/fin) d'un événement — la fin est bornée au bas de la grille. */
function eventBounds(ev: Pick<EventItem, "start" | "end">): {
  startMin: number;
  endMin: number;
} {
  const start = parseIso(ev.start);
  const end = parseIso(ev.end);
  const startMin = start.getHours() * 60 + start.getMinutes();
  let endMin = end.getHours() * 60 + end.getMinutes();
  // Fin à minuit (00:00 du lendemain) ou passage de minuit → bas de la grille.
  if (endMin <= startMin) endMin = DAY_END * 60;
  return { startMin, endMin };
}

/** Hauteur rendue d'un événement, en px. */
function eventHeight({ startMin, endMin }: { startMin: number; endMin: number }): number {
  return Math.max(24, ((endMin - startMin) / 60) * HOUR_PX - 3);
}

/** Sous ces hauteurs, la place manque : on garde le titre et on lâche le reste. */
const TIME_MIN_PX = 44;
const LOCATION_MIN_PX = 60;

/** Hauteur en dessous de laquelle un événement ARMÉ ne montre pas ses poignées
 *  de redimensionnement : deux poignées de 12 px sur un bloc au plancher de
 *  24 px (un quart d'heure) ne laissent plus un pixel pour le DÉPLACER — et
 *  c'est le déplacement qu'on vient d'armer. Au doigt, on redimensionne un
 *  quart d'heure depuis la fiche, pas en tirant sur 12 px. */
const ARMED_RESIZE_MIN_PX = 48;

/** Sous cette largeur de colonne, un titre courant ne tient plus sur une ligne :
 *  on bascule en rendu « mobile » façon Google Agenda — titre replié sur
 *  plusieurs lignes, aligné en haut à gauche, marges réduites au minimum. */
const COMPACT_COL_PX = 130;

/** ... mais seulement à partir de ce nombre de jours affichés. En vue 1 ou
 *  3 jours, même sur le plus petit téléphone, une colonne fait une centaine de
 *  pixels : le rendu large (titre centré sur deux lignes, coins arrondis,
 *  police 12 px) y est plus beau, et c'est lui qu'on garde. */
const COMPACT_MIN_DAYS = 4;

/** Plancher de sécurité : sous cette largeur, plus rien ne se lit en rendu
 *  large, quel que soit le nombre de jours affichés. */
const COMPACT_FLOOR_PX = 64;

/** Largeur de la colonne des heures selon le rendu. */
const GUTTER_COMPACT_PX = 42;
const GUTTER_WIDE_PX = 52;
const GUTTER_FEW_DAYS_PX = 60;

/** En compact, l'heure n'est affichée que si le bloc est assez large pour elle
 *  (sur un téléphone en vue 7 jours, le titre prend toute la place). */
const COMPACT_TIME_MIN_PX = 88;

/** Hauteur en dessous de laquelle un bloc compact ne tient qu'une ligne. */
const COMPACT_TWO_LINES_PX = 27;

/** Coupure des mots trop longs pour la colonne (« statistiques »). */
const WRAP_ANYWHERE: React.CSSProperties = {
  overflowWrap: "anywhere",
  wordBreak: "break-word",
};

/** Hauteur à partir de laquelle un bloc large peut donner deux lignes au titre
 *  (deux lignes + heure + lieu, sans rogner le reste). */
const WIDE_TWO_LINES_PX = 60;

/** Hauteurs de référence des lignes d'un bloc, en px — elles servent à savoir
 *  combien de rappels tiennent sous le titre, l'heure et le lieu. */
const TITLE_LINE_PX = 15;
const TIME_LINE_PX = 13;
const LOCATION_LINE_PX = 12;
const CHECKLIST_LINE_PX = 12;

type ChecklistFit = {
  /** Les rappels encore à cocher (les autres ont fini leur travail). */
  todo: ChecklistItem[];
  /** Combien de lignes le bloc peut leur donner. */
  maxLines: number;
};

/**
 * Ce qu'un bloc peut montrer de ses rappels. Le budget se prend sur ce qui
 * reste APRÈS le titre, l'heure et le lieu : les rappels se posent au bas du
 * bloc, ils ne prennent pas la place du reste.
 */
function checklistFit(
  checklist: ChecklistItem[] | undefined,
  location: string | undefined,
  heightPx: number,
  widthPx: number,
  compact: boolean
): ChecklistFit {
  const todo = (checklist ?? []).filter((c) => !c.done);
  const none: ChecklistFit = { todo, maxLines: 0 };
  if (todo.length === 0) return none;
  // Même règle que l'heure : sous cette largeur (téléphone en vue 7 jours), le
  // texte d'un rappel ne se lit plus, le titre prime.
  if (compact && widthPx < COMPACT_TIME_MIN_PX) return none;
  const showsTime = compact
    ? heightPx >= COMPACT_TWO_LINES_PX && heightPx >= TIME_MIN_PX
    : heightPx >= TIME_MIN_PX;
  const showsLocation = Boolean(location) && (compact || heightPx >= LOCATION_MIN_PX);
  const used =
    TITLE_LINE_PX +
    (showsTime ? TIME_LINE_PX : 0) +
    (showsLocation ? LOCATION_LINE_PX : 0);
  const maxLines = Math.max(0, Math.floor((heightPx - used) / CHECKLIST_LINE_PX));
  return { todo, maxLines };
}

/** Titre sur deux lignes en rendu large : on coupe aux espaces, pas au milieu
 *  des mots — la colonne est assez large pour ça. */
const CLAMP_TWO_LINES: React.CSSProperties = {
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 2,
  overflow: "hidden",
  overflowWrap: "break-word",
};

/** Rien du bloc du dessous ne dépasse (mêmes heures, ou recouvert de bout en
 *  bout) : celui du dessus ne prend que la moitié de la colonne — sinon on ne
 *  verrait plus rien de celui du dessous, pas même son nom. */
const STACK_STEP_HIDDEN = 0.5;
/** Chevauchement partiel : le bloc du dessus prend presque toute la largeur —
 *  celui du dessous garde une bande libre en haut ou en bas, et c'est là que
 *  son nom va se poser. */
const STACK_STEP_PARTIAL = 0.14;
/** Même à quatre empilés, le bloc du dessus garde un tiers de colonne. */
const STACK_MAX_OFFSET = 0.66;
/** Une bande libre ne compte que si un nom peut s'y lire. */
const STACK_TITLE_MIN_PX = TITLE_LINE_PX;

type StackLayout = {
  /** Décalage gauche, en fraction de la largeur de colonne (0 = pleine largeur). */
  offset: number;
  /** Étage d'empilement (z-index). */
  depth: number;
  /** Où poser le nom pour qu'il reste lisible : en haut (comme en rendu
   *  resserré), ou dans la bande du bas quand c'est le haut qui est recouvert.
   *  null = bloc seul, rendu habituel (centré en vue large). */
  anchor: "top" | "bottom" | null;
};

/** Positionnement d'événements qui se chevauchent : ils se SUPERPOSENT, alignés
 *  à droite de la colonne du jour, le plus récent par-dessus — la colonne n'est
 *  jamais coupée en deux. */
function computeOverlapLayout(events: EventItem[]): Map<string, StackLayout> {
  const result = new Map<string, StackLayout>();
  if (events.length === 0) return result;
  // À heure de début égale, le dernier arrivé passe DEVANT (ordre du tableau).
  const rank = new Map(events.map((ev, i) => [ev.id, i]));
  const sorted = [...events].sort((a, b) => {
    const d = parseIso(a.start).getTime() - parseIso(b.start).getTime();
    return d !== 0 ? d : rank.get(a.id)! - rank.get(b.id)!;
  });
  // Étape 1 : regrouper en clusters de chevauchement (union-find glouton).
  const clusters: EventItem[][] = [];
  for (const ev of sorted) {
    const { startMin, endMin } = eventBounds(ev);
    // Trouve un cluster existant qui chevauche cet événement.
    let found = false;
    for (const cl of clusters) {
      for (const other of cl) {
        const ob = eventBounds(other);
        if (ob.startMin < endMin && startMin < ob.endMin) {
          cl.push(ev);
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (!found) clusters.push([ev]);
  }
  // Étape 2 : dans chaque cluster, empiler. Un bloc ne se décale que par
  // rapport à ceux qu'il recouvre VRAIMENT (A 9h-10h, B 9h30-11h, C 10h30-12h
  // sont un seul cluster, mais C repart de la pleine largeur : il ne touche
  // pas A). Le pas dépend de ce qu'il cache : tout, ou seulement une part.
  const pxOf = (min: number) => (min / 60) * HOUR_PX;
  for (const cluster of clusters) {
    const bounds = cluster.map((ev) => eventBounds(ev));
    const meet = (i: number, j: number) =>
      bounds[i].startMin < bounds[j].endMin && bounds[j].startMin < bounds[i].endMin;
    // Qui recouvre qui : tout bloc PLUS TARD dans l'ordre passe par-dessus.
    const over = cluster.map((_, i) =>
      cluster.map((_, j) => j).filter((j) => j > i && meet(i, j))
    );
    // Ce qui DÉPASSE de chaque bloc, en haut et en bas de ce qui le recouvre :
    // la bande où son nom restera lisible. Rien nulle part = bloc caché.
    const freeTop = cluster.map((_, i) =>
      over[i].length === 0
        ? Infinity
        : Math.min(...over[i].map((j) => bounds[j].startMin)) - bounds[i].startMin
    );
    const freeBottom = cluster.map((_, i) =>
      over[i].length === 0
        ? Infinity
        : bounds[i].endMin - Math.max(...over[i].map((j) => bounds[j].endMin))
    );
    const readable = (px: number) => px >= STACK_TITLE_MIN_PX;
    const hidden = (i: number) =>
      !readable(pxOf(freeTop[i])) && !readable(pxOf(freeBottom[i]));

    const offsets: number[] = [];
    const depths: number[] = [];
    for (let i = 0; i < cluster.length; i++) {
      let offset = 0;
      let depth = 0;
      for (let p = 0; p < i; p++) {
        if (!meet(p, i)) continue;
        offset = Math.max(
          offset,
          offsets[p] + (hidden(p) ? STACK_STEP_HIDDEN : STACK_STEP_PARTIAL)
        );
        depth = Math.max(depth, depths[p] + 1);
      }
      offsets[i] = Math.min(offset, STACK_MAX_OFFSET);
      depths[i] = depth;
    }
    for (let i = 0; i < cluster.length; i++) {
      // Empilé (décalé, ou recouvert) : le nom se range en haut à gauche,
      // comme en rendu resserré — et passe en bas si c'est le haut du bloc
      // qui disparaît sous le voisin.
      const stacked = offsets[i] > 0 || over[i].length > 0;
      const anchor = !stacked
        ? null
        : readable(pxOf(freeTop[i])) || !readable(pxOf(freeBottom[i]))
          ? "top"
          : "bottom";
      result.set(cluster[i].id, { offset: offsets[i], depth: depths[i], anchor });
    }
  }
  return result;
}

/** Déplacement, ou étirement par le bas (`resize-end`) / par le haut (`resize-start`). */
type DragMode = "move" | "resize-start" | "resize-end";

type DragState = {
  id: string;
  /** décalage pointeur → début d'événement, en px */
  grabOffsetPx: number;
  /** durée en minutes (déplacement) */
  durationMin: number;
  /** minutes de journée d'origine (resize) */
  origStartMin: number;
  origEndMin: number;
  mode: DragMode;
  /** positions actuelles, en minutes de journée */
  startMin: number;
  endMin: number;
  /** jour actuel (index dans days) */
  dayIndex: number;
  /** largeur d'une colonne jour en px (positionnement du fantôme) */
  colWidth: number;
  moved: boolean;
  /** index de la colonne sous le pointeur au pointerdown (natif, fiable) */
  startDayIndex: number;
};

/** État du drag partagé avec les gestionnaires window (en dehors du cycle React). */
type DragSession = {
  id: string;
  mode: DragMode;
  grabOffsetPx: number;
  durationMin: number;
  origStartMin: number;
  origEndMin: number;
  startDayIndex: number;
  /** dernier jour affiché (hystérèse de changement de colonne) */
  lastDayIndex: number;
  startClientY: number;
  colWidth: number;
  moved: boolean;
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** Mélange fg sur bg (opaque) → hex plein, pour des événements sans transparence. */
function blend(fg: string, bg: string, amount: number): string {
  const [fr, fg_, fb] = hexToRgb(fg);
  const [br, bg_, bb] = hexToRgb(bg);
  const mix = (a: number, b: number) => Math.round(a * amount + b * (1 - amount));
  const to2 = (n: number) => n.toString(16).padStart(2, "0");
  return `#${to2(mix(fr, br))}${to2(mix(fg_, bg_))}${to2(mix(fb, bb))}`;
}

type Props = {
  days: Date[];
  events: EventItem[];
  onEventClick: (event: EventItem) => void;
  onSlotClick: (start: Date) => void;
  onEventMove: (id: string, start: Date, end: Date) => void;
};

export default function Calendar({
  days,
  events,
  onEventClick,
  onSlotClick,
  onEventMove,
}: Props) {
  const hours = Array.from(
    { length: DAY_END - DAY_START },
    (_, i) => DAY_START + i
  );
  const slots = Array.from(
    { length: (DAY_END - DAY_START) * (60 / SNAP_MIN) },
    (_, i) => DAY_START * 60 + i * SNAP_MIN
  );

  // Heure courante — rafraîchie chaque minute pour la ligne "maintenant".
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Largeur utile de la grille : elle décide du rendu (large ou compact).
  const [gridW, setGridW] = useState(0);
  // Décision prise sur une gouttière de référence : le rendu choisi ne doit pas
  // changer la largeur qui sert à le choisir (sinon la vue oscille).
  const refColWidth = gridW > 0 ? (gridW - GUTTER_WIDE_PX) / days.length : 0;
  const compact =
    refColWidth > 0 &&
    refColWidth <
      (days.length >= COMPACT_MIN_DAYS ? COMPACT_COL_PX : COMPACT_FLOOR_PX);
  // En compact, la colonne des heures est rognée : chaque pixel rendu aux
  // colonnes de jours, c'est un caractère de plus par ligne de titre.
  const gutter = compact
    ? GUTTER_COMPACT_PX
    : days.length >= 7
      ? GUTTER_WIDE_PX
      : GUTTER_FEW_DAYS_PX;
  const colWidth = gridW > 0 ? (gridW - gutter) / days.length : 0;
  const gridCols = `${gutter}px repeat(${days.length}, minmax(0, 1fr))`;
  // Gouttière entre deux événements voisins (et sur les bords de colonne).
  const eventInset = compact ? 1 : 6;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowVisible = nowMin >= DAY_START * 60 && nowMin <= DAY_END * 60;
  const nowTop = ((nowMin - DAY_START * 60) / 60) * HOUR_PX;

  // --- Drag & drop (déplacement / redimensionnement) ---
  const [drag, setDrag] = useState<DragState | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragSession | null>(null);

  /**
   * ARMEMENT TACTILE : au doigt, un événement ne se déplace qu'une fois
   * sélectionné par une première touche.
   *
   * Sans ça, un défilement vertical qui démarrait sur un bloc le déplaçait —
   * `touch-action: none` et le `preventDefault()` du pointerdown prenaient la
   * main avant que le navigateur ne puisse faire défiler. Insupportable dès
   * qu'on parcourt sa semaine au pouce.
   *
   * À la souris, rien ne change : on saisit et on déplace directement. C'est
   * `pointerType` qui tranche, pas la taille de l'écran — un portable tactile
   * garde donc le geste direct dès qu'on utilise la souris.
   */
  const [armedId, setArmedId] = useState<string | null>(null);
  const pointerTypeRef = useRef<string>("mouse");

  // La grille défile, pas l'en-tête : sans compensation, la barre de défilement
  // rétrécit les colonnes du corps et les traits ne tombent plus en face de ceux
  // des numéros de jour. On mesure sa largeur et on la réserve dans l'en-tête.
  const [scrollbarW, setScrollbarW] = useState(0);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.offsetWidth - el.clientWidth;
      setScrollbarW((prev) => (prev === w ? prev : w));
      const inner = el.clientWidth;
      setGridW((prev) => (prev === inner ? prev : inner));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [events, days.length]);

  function eventGeo(ev: EventItem, colEl: HTMLDivElement) {
    const rect = colEl.getBoundingClientRect();
    const { startMin, endMin } = eventBounds(ev);
    const top = ((startMin - DAY_START * 60) / 60) * HOUR_PX;
    const height = Math.max(24, ((endMin - startMin) / 60) * HOUR_PX - 3);
    return { rect, top, height };
  }

  function applyDrag(clientX: number, clientY: number) {
    const grid = gridRef.current;
    const s = dragRef.current;
    if (!grid || !s) return;
    const rect = grid.getBoundingClientRect();
    const y = clientY - rect.top + grid.scrollTop;
    const rawMin = DAY_START * 60 + (y / HOUR_PX) * 60;

    if (!s.moved) {
      // Seuil de 4 px avant de basculer en drag (sinon simple clic).
      if (Math.abs(clientY - s.startClientY) < 4) return;
      s.moved = true;
    }

    const colWidth = s.colWidth;
    let dayIndex = s.lastDayIndex;
    if (colWidth > 0) {
      // Hystérèse : on ne change de colonne qu'une fois le pointeur
      // franchement engagé dans la colonne voisine (> 60 % du chemin).
      const fx = (clientX - rect.left - gutter) / colWidth;
      if (Math.abs(fx - dayIndex) > 0.6) {
        dayIndex = Math.min(Math.max(Math.round(fx), 0), days.length - 1);
        s.lastDayIndex = dayIndex;
      }
    }

    if (s.mode === "move") {
      const startMin = snapMin(rawMin - (s.grabOffsetPx / HOUR_PX) * 60);
      const clamped = Math.min(startMin, DAY_END * 60 - s.durationMin);
      setDrag({
        id: s.id,
        grabOffsetPx: s.grabOffsetPx,
        durationMin: s.durationMin,
        origStartMin: s.origStartMin,
        origEndMin: s.origEndMin,
        mode: s.mode,
        startMin: clamped,
        endMin: clamped + s.durationMin,
        dayIndex,
        colWidth,
        moved: true,
        startDayIndex: s.startDayIndex,
      });
    } else {
      // Étirement : le bord tiré suit le pointeur, l'autre reste à sa place.
      const startMin =
        s.mode === "resize-start"
          ? Math.min(snapMin(rawMin), s.origEndMin - SNAP_MIN)
          : s.origStartMin;
      const endMin =
        s.mode === "resize-start"
          ? s.origEndMin
          : Math.max(snapMin(rawMin), s.origStartMin + SNAP_MIN);
      setDrag({
        id: s.id,
        grabOffsetPx: 0,
        durationMin: s.durationMin,
        origStartMin: s.origStartMin,
        origEndMin: s.origEndMin,
        mode: s.mode,
        startMin,
        endMin,
        dayIndex: s.startDayIndex,
        colWidth,
        moved: true,
        startDayIndex: s.startDayIndex,
      });
    }
  }

  function cancelDrag() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    dragRef.current = null;
    setDrag(null);
  }

  function onMove(e: PointerEvent) {
    applyDrag(e.clientX, e.clientY);
  }

  function onUp() {
    const s = dragRef.current;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    dragRef.current = null;
    if (s?.moved) {
      // Un déplacement effectué désarme : le suivant redemandera une touche.
      setArmedId(null);
      setDrag((d) => {
        if (d) {
          const day = days[d.dayIndex] ?? days[s.startDayIndex];
          const start = new Date(day);
          start.setHours(0, d.startMin, 0, 0);
          const end =
            d.endMin >= DAY_END * 60
              ? startOfNextDay(day)
              : new Date(new Date(day).setHours(0, d.endMin, 0, 0));
          onEventMove(d.id, start, end);
        }
        return null;
      });
    } else {
      setDrag(null);
    }
  }

  function startOfNextDay(day: Date): Date {
    const d = addDays(day, 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function beginDrag(
    ev: EventItem,
    colEl: HTMLDivElement,
    dayIndex: number,
    e: React.PointerEvent,
    mode: DragMode
  ) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointerTypeRef.current = e.pointerType;
    // Au doigt et pas encore armé : on ne saisit RIEN et on ne bloque rien —
    // le navigateur fait défiler normalement. Le clic qui suivra (si le doigt
    // n'a pas bougé) armera l'événement.
    if (e.pointerType !== "mouse" && armedId !== ev.id) return;
    e.preventDefault();
    e.stopPropagation();
    const { rect, top, height } = eventGeo(ev, colEl);
    const { startMin, endMin } = eventBounds(ev);
    dragRef.current = {
      id: ev.id,
      mode,
      grabOffsetPx: e.clientY - rect.top - top,
      durationMin: endMin - startMin,
      origStartMin: startMin,
      origEndMin: endMin,
      startDayIndex: dayIndex,
      lastDayIndex: dayIndex,
      startClientY: e.clientY,
      colWidth: rect.width,
      moved: false,
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  useEffect(() => cancelDrag, []); // nettoyage au démontage

  // Surbrillance d'1 h qui suit la souris (départ au quart d'heure survolé).
  const [hoverSlot, setHoverSlot] = useState<{
    dayIndex: number;
    min: number;
  } | null>(null);

  const dragEvent = drag ? events.find((ev) => ev.id === drag.id) : undefined;
  // Le fantôme de drag suit les mêmes règles de place que le bloc d'origine.
  const dragFit = checklistFit(
    dragEvent?.checklist,
    dragEvent?.location,
    drag ? eventHeight(drag) : 0,
    drag ? Math.max(0, drag.colWidth - 2 * eventInset) : 0,
    compact
  );

  return (
    <div className="surface-solid flex h-full flex-col overflow-hidden">
      {/* En-tête des jours */}
      <div
        className="grid border-b border-line bg-white/[0.02]"
        style={{ gridTemplateColumns: gridCols, paddingRight: scrollbarW }}
      >
        <div className="border-r border-line" />
        {days.map((day) => {
          const isToday = sameDay(day, now);
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;
          return (
            <div
              key={day.toISOString()}
              className="flex flex-col items-center gap-1 border-r border-line px-1 py-2.5 last:border-r-0"
            >
              <div
                className={`text-[10.5px] font-semibold uppercase tracking-[0.08em] ${
                  isWeekend ? "text-ink-faint" : "text-ink-soft"
                }`}
              >
                {weekdayShort(day)}
              </div>
              <div
                className={`flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-sm font-semibold tabular-nums transition ${
                  isToday
                    ? "bg-brand-gradient text-brand-ink shadow-glow-sm"
                    : "text-ink"
                }`}
              >
                {day.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Grille horaire */}
      <div
        ref={gridRef}
        onScroll={() => setArmedId((id) => (id === null ? id : null))}
        className="relative flex-1 overflow-y-auto"
      >
        <div className="grid" style={{ gridTemplateColumns: gridCols }}>
          {/* Colonne des heures */}
          <div className="border-r border-line">
            {hours.map((h) => (
              <div key={h} style={{ height: HOUR_PX }} className="relative">
                <span
                  className={`absolute -top-[7px] text-[11px] font-medium tabular-nums text-ink-faint ${
                    compact ? "right-1" : "right-2"
                  }`}
                >
                  {String(h).padStart(2, "0")}:00
                </span>
              </div>
            ))}
          </div>

          {/* Colonnes des jours */}
          {days.map((day, dayIndex) => {
            const isToday = sameDay(day, now);
            const dayEvents = events.filter((ev) =>
              sameDay(parseIso(ev.start), day)
            );
            const overlapLayout = computeOverlapLayout(dayEvents);
            return (
              <div
                key={day.toISOString()}
                onMouseLeave={() =>
                  setHoverSlot((h) => (h?.dayIndex === dayIndex ? null : h))
                }
                className={`relative border-r border-line last:border-r-0 ${
                  isToday ? "bg-brand/[0.06]" : ""
                }`}
              >
                {/* Créneaux d'un quart d'heure (clic = nouvel événement d'1 h) */}
                <div
                  onMouseMove={(e) => {
                    // Position locale précise (les sous-divs n'ont pas de hauteur
                    // fixe : SLOT_PX est une string, elles se partagent la colonne).
                    const rect = e.currentTarget.getBoundingClientRect();
                    const min = floorSnapMin(
                      DAY_START * 60 +
                        ((e.clientY - rect.top) / rect.height) *
                          (DAY_END - DAY_START) * 60
                    );
                    setHoverSlot((h) =>
                      h && h.dayIndex === dayIndex && h.min === min
                        ? h
                        : { dayIndex, min }
                    );
                  }}
                >
                  {slots.map((min) => {
                    // Trait fort sur le créneau dont le bas tombe pile sur l'heure
                    // (la bordure est dessinée en bas du créneau).
                    const isHourLine = (min + SNAP_MIN) % 60 === 0;
                    return (
                      <div
                        key={min}
                        style={{ height: SLOT_PX }}
                        className={`border-b transition-colors ${
                          isHourLine ? "border-line/70" : "border-transparent"
                        }`}
                        onClick={() => {
                          setArmedId(null);
                          const start = new Date(day);
                          start.setHours(0, min, 0, 0);
                          onSlotClick(start);
                        }}
                      />
                    );
                  })}
                </div>

                {/* Surbrillance du créneau d'1 h qui serait créé au clic */}
                {hoverSlot && hoverSlot.dayIndex === dayIndex && !drag && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-[5] rounded-md bg-white/[0.06] ring-1 ring-inset ring-white/10"
                    style={{
                      top: `${((hoverSlot.min - DAY_START * 60) / 60) * HOUR_PX}px`,
                      height: `${HOUR_PX}px`,
                    }}
                  />
                )}

                {/* Ligne "maintenant" */}
                {isToday && nowVisible && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
                    style={{ top: nowTop }}
                  >
                    <span className="-ml-[5px] h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_0_3px_rgba(56,189,248,0.25)]" />
                    <span className="h-px flex-1 bg-accent/70" />
                  </div>
                )}

                {dayEvents.map((ev) => {
                  const color = ev.color || "#2dd4bf";
                  // Invitation Google pas encore acceptée : bordure en pointillés.
                  const pending = ev.google?.myResponse === "needsAction";
                  // Événement masqué pendant son drag (l'aperçu prend le relais).
                  if (drag && drag.id === ev.id && drag.moved) return null;
                  const bounds = eventBounds(ev);
                  const heightPx = eventHeight(bounds);
                  const armed = armedId === ev.id;
                  // `armed` n'arrive que par une touche (la souris n'arme
                  // jamais) : ce seuil ne concerne donc que le tactile.
                  const showHandles = !armed || heightPx >= ARMED_RESIZE_MIN_PX;
                  const layout = overlapLayout.get(ev.id);
                  const offset = layout?.offset ?? 0;
                  // Empilé : rendu resserré (nom en haut à gauche, petit), même
                  // en vue large — un titre centré dans un bloc à demi couvert
                  // ne se lit plus.
                  const anchor = layout?.anchor ?? null;
                  const tight = compact || anchor !== null;
                  const showTime = !tight && heightPx >= TIME_MIN_PX;
                  // Superposé : aligné à DROITE de la colonne, décalé à gauche.
                  const insetStyle: React.CSSProperties =
                    offset > 0
                      ? { left: `calc(${offset * 100}% + ${eventInset}px)`, right: eventInset }
                      : { left: eventInset, right: eventInset };
                  // Largeur réelle du bloc : en compact, elle décide si l'heure
                  // tient à côté du titre.
                  const blockWidth = colWidth * (1 - offset) - 2 * eventInset;
                  const fit = checklistFit(
                    ev.checklist,
                    ev.location,
                    heightPx,
                    blockWidth,
                    tight
                  );
                  return (
                    <div
                      key={ev.id}
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        // Au doigt, la première touche ne fait qu'ARMER (elle
                        // sélectionne) ; la suivante ouvre la fiche.
                        if (pointerTypeRef.current !== "mouse" && !armed) {
                          setArmedId(ev.id);
                          return;
                        }
                        setArmedId(null);
                        onEventClick(ev);
                      }}
                      onPointerDown={(e) =>
                        beginDrag(ev, e.currentTarget.parentElement as HTMLDivElement, dayIndex, e, "move")
                      }
                      style={{
                        ...eventStyle(ev),
                        ...insetStyle,
                        backgroundColor: blend(color, EVENT_BASE, compact ? 0.34 : 0.28),
                        borderColor: blend(color, EVENT_BASE, 0.55),
                        // Non armé : `pan-y` rend le défilement au navigateur.
                        // Armé : on prend la main sur le geste.
                        touchAction: armed ? "none" : "pan-y",
                        // Empilement : le bloc du dessus passe devant, sans
                        // jamais monter jusqu'à la ligne « maintenant » (z-20).
                        zIndex: armed ? 25 : Math.min(19, 10 + (layout?.depth ?? 0)),
                      }}
                      className={`${
                        compact
                          ? `animate-fade-in group absolute z-10 flex cursor-grab flex-col overflow-hidden rounded-md border px-0.5 py-px shadow-soft active:cursor-grabbing ${
                              pending ? "border-dashed" : ""
                            }`
                          : `animate-fade-in group absolute z-10 flex cursor-grab flex-col overflow-hidden rounded-xl border shadow-soft transition-all duration-200 hover:-translate-y-px hover:shadow-lift active:cursor-grabbing ${
                              // Empilé : pas de liseré, donc pas de marge à lui
                              // réserver — chaque pixel va au nom.
                              tight
                                ? "px-1 py-0.5"
                                : showTime
                                  ? "p-1.5 pl-2.5"
                                  : "p-1 pl-2.5"
                            } ${pending ? "border-dashed" : ""}`
                      } ${
                        // Le nom se range là où le bloc reste à découvert.
                        anchor === "bottom"
                          ? "items-stretch justify-end text-left"
                          : tight
                            ? "items-stretch justify-start text-left"
                            : "items-center justify-center text-center"
                      } ${ev.pendingSync ? "border-dashed" : ""} ${
                        armed ? "z-20 shadow-lift ring-2 ring-brand/80" : ""
                      }`}
                      title={
                        ev.pendingSync
                          ? "Modification faite hors ligne, en attente d'envoi"
                          : pending
                            ? "Invitation en attente de ta réponse"
                            : undefined
                      }
                    >
                      {/* Liseré de couleur et pastille Google : en resserré, chaque
                          pixel horizontal compte, le fond porte déjà la couleur. */}
                      {!tight && (
                        <span
                          className="absolute inset-y-1.5 left-1 w-1 rounded-full"
                          style={{ backgroundColor: color }}
                        />
                      )}
                      {/* Pastille : modification faite hors ligne, pas encore
                          envoyée. Gardée même en compact — savoir qu'une écriture
                          n'est pas partie compte plus qu'un pixel de largeur. */}
                      {ev.pendingSync && (
                        <span
                          aria-hidden
                          className={`pointer-events-none absolute h-1.5 w-1.5 animate-pulse rounded-full bg-white/60 ${
                            tight ? "bottom-px right-px" : "bottom-1.5 right-1.5"
                          }`}
                        />
                      )}
                      {!tight && ev.source === "google" && (
                        <span
                          aria-hidden
                          className="pointer-events-none absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full ring-1 ring-white/50"
                          style={{ backgroundColor: pending ? "transparent" : color }}
                        />
                      )}
                      <EventContent
                        title={ev.title}
                        location={ev.location}
                        checklist={fit}
                        reserveCorner={Boolean(ev.pendingSync)}
                        timeLabel={`${formatTime(parseIso(ev.start))} – ${formatTime(
                          parseIso(ev.end)
                        )}`}
                        heightPx={heightPx}
                        widthPx={blockWidth}
                        compact={tight}
                        bottomAnchored={anchor === "bottom"}
                      />
                      {/* Poignées de redimensionnement — révélées au survol à la
                          souris, et en permanence sur un événement armé. */}
                      {showHandles && (
                        <>
                          <span
                            onPointerDown={(e) =>
                              beginDrag(ev, e.currentTarget.parentElement?.parentElement as HTMLDivElement, dayIndex, e, "resize-start")
                            }
                            className={`absolute inset-x-0 top-0 cursor-ns-resize transition-opacity group-hover:opacity-100 ${
                              armed ? "h-3 opacity-100" : "h-2 opacity-0"
                            }`}
                          >
                            <span className="absolute top-[3px] left-1/2 h-[3px] w-8 -translate-x-1/2 rounded-full bg-white/30" />
                          </span>
                          <span
                            onPointerDown={(e) =>
                              beginDrag(ev, e.currentTarget.parentElement?.parentElement as HTMLDivElement, dayIndex, e, "resize-end")
                            }
                            className={`absolute inset-x-0 bottom-0 cursor-ns-resize transition-opacity group-hover:opacity-100 ${
                              armed ? "h-3 opacity-100" : "h-2 opacity-0"
                            }`}
                          >
                            <span className="absolute bottom-[3px] left-1/2 h-[3px] w-8 -translate-x-1/2 rounded-full bg-white/30" />
                          </span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Fantôme de l'événement en cours de drag (positionné au niveau de la grille
            pour animer les changements de colonne) */}
        {drag && dragEvent && (
          <div
            className={
              compact
                ? "pointer-events-none absolute z-30 overflow-hidden rounded-md border border-dashed px-0.5 py-px transition-transform duration-150 ease-out"
                : `pointer-events-none absolute z-30 overflow-hidden rounded-xl border border-dashed pl-2.5 transition-transform duration-150 ease-out ${
                    eventHeight(drag) >= TIME_MIN_PX ? "p-1.5 pl-2.5" : "p-1 pl-2.5"
                  }`
            }
            style={{
              top: `${((drag.startMin - DAY_START * 60) / 60) * HOUR_PX + 1}px`,
              height: `${eventHeight(drag)}px`,
              left: `${gutter + eventInset}px`,
              width: `${Math.max(0, drag.colWidth - 2 * eventInset)}px`,
              transform: `translateX(${drag.dayIndex * drag.colWidth}px)`,
              backgroundColor: blend(dragEvent.color || "#2dd4bf", EVENT_BASE, 0.22),
              borderColor: dragEvent.color || "#2dd4bf",
            }}
          >
            {!compact && (
              <span
                className="absolute inset-y-1.5 left-1 w-1 rounded-full"
                style={{ backgroundColor: dragEvent.color || "#2dd4bf" }}
              />
            )}
            <div
              className={`flex h-full flex-col ${
                compact
                  ? "items-stretch justify-start text-left"
                  : "items-center justify-center"
              }`}
            >
              <EventContent
                title={dragEvent.title}
                location={dragEvent.location}
                checklist={dragFit}
                timeLabel={`${formatTime(
                  new Date(
                    new Date(days[drag.dayIndex]).setHours(0, drag.startMin, 0, 0)
                  )
                )} – ${
                  drag.endMin >= DAY_END * 60
                    ? "00:00"
                    : formatTime(
                        new Date(
                          new Date(days[drag.dayIndex]).setHours(0, drag.endMin, 0, 0)
                        )
                      )
                }`}
                heightPx={eventHeight(drag)}
                widthPx={drag.colWidth - 2 * eventInset}
                compact={compact}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Contenu d'un bloc d'événement.
 *  - large : titre sur une ligne, centré, heure et lieu si la hauteur le permet ;
 *  - compact (téléphone) : titre replié sur plusieurs lignes en haut à gauche,
 *    lieu dans les lignes restantes, heure abandonnée — c'est le titre qui doit
 *    rester lisible, comme dans la vue semaine de Google Agenda. */
function EventContent({
  title,
  location,
  checklist,
  timeLabel,
  heightPx,
  widthPx,
  compact,
  reserveCorner = false,
  bottomAnchored = false,
}: {
  title: string;
  location?: string;
  checklist: ChecklistFit;
  timeLabel: string;
  heightPx: number;
  widthPx: number;
  compact: boolean;
  /** Une pastille occupe le coin bas-droit (synchro en attente) : les rappels,
   *  qui tiennent la bande du bas, lui laissent la place. */
  reserveCorner?: boolean;
  /** Bloc recouvert par le haut : le nom se pose dans la bande libre du bas. */
  bottomAnchored?: boolean;
}) {
  const reminders = (
    <ChecklistLines
      items={checklist.todo}
      maxLines={checklist.maxLines}
      reserveCorner={reserveCorner}
    />
  );
  const hasReminders = checklist.todo.length > 0 && checklist.maxLines > 0;

  /**
   * Avec des rappels, le bloc se coupe en deux : le haut (titre, heure, lieu)
   * prend toute la place libre et garde son alignement d'origine, les rappels
   * se posent au ras du bas. Plus il y en a, plus le haut se resserre — et le
   * titre remonte de lui-même. Sans rappel, rien ne change.
   */
  const frame = (top: React.ReactNode) =>
    hasReminders ? (
      <>
        <div
          className={`flex min-h-0 w-full flex-1 flex-col ${
            bottomAnchored
              ? "items-stretch justify-end"
              : compact
                ? "items-stretch justify-start"
                : "items-center justify-center"
          }`}
        >
          {top}
        </div>
        {reminders}
      </>
    ) : (
      <>{top}</>
    );

  if (compact) {
    // Trop court pour deux lignes : une seule ligne tronquée vaut mieux qu'une
    // deuxième coupée en son milieu.
    const oneLine = heightPx < COMPACT_TWO_LINES_PX;
    // L'heure ne passe qu'en colonne large : sur un téléphone en vue 7 jours,
    // c'est le titre qui doit rester lisible.
    const withTime =
      !oneLine && widthPx >= COMPACT_TIME_MIN_PX && heightPx >= TIME_MIN_PX;
    // Sinon, pas de mesure du texte : le titre prend les lignes qu'il lui faut,
    // le lieu occupe ce qui reste et le bloc rogne le débordement (comme Google).
    return frame(
      <>
        <div
          className={`w-full shrink-0 text-[11px] font-semibold leading-[1.15] text-ink ${
            oneLine ? "truncate" : ""
          }`}
          style={oneLine ? undefined : WRAP_ANYWHERE}
        >
          {title}
        </div>
        {withTime && (
          <div className="w-full shrink-0 truncate text-[10px] font-medium tabular-nums text-ink-soft">
            {timeLabel}
          </div>
        )}
        {/* Sans rappel, le lieu occupe toutes les lignes restantes (comme
            Google). Avec, il se contente d'une ligne : c'est ce que le budget
            des rappels lui a réservé. */}
        {location && (
          <div
            className={`w-full overflow-hidden text-[10px] font-medium leading-[1.15] text-ink-faint ${
              hasReminders ? "shrink-0 truncate" : "min-h-0"
            }`}
            style={hasReminders ? undefined : WRAP_ANYWHERE}
          >
            {location}
          </div>
        )}
      </>
    );
  }
  const showTime = heightPx >= TIME_MIN_PX;
  const showLocation = heightPx >= LOCATION_MIN_PX;
  // Assez haut pour un titre sur deux lignes : mieux vaut le replier que le
  // couper à « Cours de stat… ».
  const twoLines = heightPx >= WIDE_TWO_LINES_PX;
  return frame(
    <>
      {/* Trop court pour deux lignes : le titre prime sur l'heure. */}
      <div
        className={`w-full text-center font-semibold text-ink ${
          showTime ? "text-xs" : "text-[11px] leading-tight"
        } ${twoLines ? "" : "truncate"}`}
        style={twoLines ? CLAMP_TWO_LINES : undefined}
      >
        {title}
      </div>
      {showTime && (
        <div className="truncate text-[10.5px] font-medium tabular-nums text-ink-soft">
          {timeLabel}
        </div>
      )}
      {location && showLocation && (
        <div className="w-full truncate text-[10px] font-medium text-ink-faint">
          {location}
        </div>
      )}
    </>
  );
}

/**
 * Les rappels d'un événement, sous tout le reste du bloc : une puce bleue qui
 * scintille — le bleu de la ligne « maintenant » — et le texte du rappel en
 * petit à côté. Toujours alignés à gauche, même dans un bloc centré : une
 * liste se lit le long de ses puces, pas en accordéon.
 * Ce qui ne tient pas est résumé par un « +N » plutôt que coupé en silence.
 */
function ChecklistLines({
  items,
  maxLines,
  reserveCorner = false,
}: {
  items: ChecklistItem[];
  maxLines: number;
  reserveCorner?: boolean;
}) {
  if (items.length === 0 || maxLines < 1) return null;
  // Le « +N » coûte lui-même une ligne : il ne la prend que s'il sert.
  const room = items.length <= maxLines ? maxLines : Math.max(1, maxLines - 1);
  const shown = items.slice(0, room);
  const hidden = items.length - shown.length;
  return (
    // Une ligne par rappel, jamais deux : c'est ce qui rend le budget de place
    // exact, donc l'ancrage en bas stable. Le texte entier reste dans l'infobulle
    // et dans la fiche.
    <ul
      className={`w-full shrink-0 overflow-hidden text-left ${
        reserveCorner ? "pr-3" : ""
      }`}
    >
      {shown.map((item) => (
        <li
          key={item.id}
          className="flex items-center gap-1 text-[9.5px] font-medium leading-[1.25] text-ink-soft"
          title={item.text}
        >
          <span className="animate-twinkle h-1.5 w-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_0_2px_rgba(56,189,248,0.22)]" />
          <span className="min-w-0 truncate">{item.text}</span>
        </li>
      ))}
      {hidden > 0 && (
        <li className="pl-[10px] text-[9.5px] font-medium leading-[1.25] text-ink-faint">
          +{hidden}
        </li>
      )}
    </ul>
  );
}

/** Position (top/height) d'un événement dans la grille. */
function eventStyle(ev: EventItem) {
  const { startMin, endMin } = eventBounds(ev);
  const top = ((startMin - DAY_START * 60) / 60) * HOUR_PX;
  return { top: `${top}px`, height: `${eventHeight({ startMin, endMin })}px` };
}

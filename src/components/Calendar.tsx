"use client";

import { useEffect, useRef, useState } from "react";
import { EventItem } from "@/lib/types";
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

type DragState = {
  id: string;
  /** décalage pointeur → début d'événement, en px */
  grabOffsetPx: number;
  /** durée en minutes (déplacement) */
  durationMin: number;
  /** minutes de journée d'origine (resize) */
  origStartMin: number;
  origEndMin: number;
  mode: "move" | "resize";
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
  mode: "move" | "resize";
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

  const gutter = days.length >= 7 ? 52 : 60;
  const gridCols = `${gutter}px repeat(${days.length}, minmax(0, 1fr))`;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowVisible = nowMin >= DAY_START * 60 && nowMin <= DAY_END * 60;
  const nowTop = ((nowMin - DAY_START * 60) / 60) * HOUR_PX;

  // --- Drag & drop (déplacement / redimensionnement) ---
  const [drag, setDrag] = useState<DragState | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragSession | null>(null);

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
      const endMin = Math.max(snapMin(rawMin), s.origStartMin + SNAP_MIN);
      setDrag({
        id: s.id,
        grabOffsetPx: 0,
        durationMin: s.durationMin,
        origStartMin: s.origStartMin,
        origEndMin: s.origEndMin,
        mode: s.mode,
        startMin: s.origStartMin,
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
    mode: "move" | "resize"
  ) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
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

  return (
    <div className="surface-solid flex h-full flex-col overflow-hidden">
      {/* En-tête des jours */}
      <div
        className="grid border-b border-line bg-white/[0.02]"
        style={{ gridTemplateColumns: gridCols }}
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
      <div ref={gridRef} className="relative flex-1 overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: gridCols }}>
          {/* Colonne des heures */}
          <div className="border-r border-line">
            {hours.map((h) => (
              <div key={h} style={{ height: HOUR_PX }} className="relative">
                <span className="absolute -top-[7px] right-2 text-[11px] font-medium tabular-nums text-ink-faint">
                  {h}:00
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
                  // Événement masqué pendant son drag (l'aperçu prend le relais).
                  if (drag && drag.id === ev.id && drag.moved) return null;
                  return (
                    <div
                      key={ev.id}
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick(ev);
                      }}
                      onPointerDown={(e) =>
                        beginDrag(ev, e.currentTarget.parentElement as HTMLDivElement, dayIndex, e, "move")
                      }
                      style={{
                        ...eventStyle(ev),
                        backgroundColor: blend(color, EVENT_BASE, 0.28),
                        borderColor: blend(color, EVENT_BASE, 0.55),
                        touchAction: "none",
                      }}
                      className="animate-fade-in group absolute left-1.5 right-1.5 z-10 flex cursor-grab flex-col items-center justify-center overflow-hidden rounded-xl border p-1.5 pl-2.5 text-center shadow-soft transition-all duration-200 hover:-translate-y-px hover:shadow-lift active:cursor-grabbing"
                    >
                      <span
                        className="absolute inset-y-1.5 left-1 w-1 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <div className="w-full truncate text-xs font-semibold text-ink">
                        {ev.title}
                      </div>
                      <div className="truncate text-[10.5px] font-medium tabular-nums text-ink-soft">
                        {formatTime(parseIso(ev.start))} –{" "}
                        {formatTime(parseIso(ev.end))}
                      </div>
                      {/* Poignée de redimensionnement (bas) */}
                      <span
                        onPointerDown={(e) =>
                          beginDrag(ev, e.currentTarget.parentElement?.parentElement as HTMLDivElement, dayIndex, e, "resize")
                        }
                        className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <span className="absolute bottom-[3px] left-1/2 h-[3px] w-8 -translate-x-1/2 rounded-full bg-white/30" />
                      </span>
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
            className="pointer-events-none absolute z-30 overflow-hidden rounded-xl border border-dashed p-1.5 pl-2.5 transition-transform duration-150 ease-out"
            style={{
              top: `${((drag.startMin - DAY_START * 60) / 60) * HOUR_PX + 1}px`,
              height: `${Math.max(24, ((drag.endMin - drag.startMin) / 60) * HOUR_PX - 3)}px`,
              left: `${gutter + 6}px`,
              width: `${Math.max(0, drag.colWidth - 12)}px`,
              transform: `translateX(${drag.dayIndex * drag.colWidth}px)`,
              backgroundColor: blend(dragEvent.color || "#2dd4bf", EVENT_BASE, 0.22),
              borderColor: dragEvent.color || "#2dd4bf",
            }}
          >
            <span
              className="absolute inset-y-1.5 left-1 w-1 rounded-full"
              style={{ backgroundColor: dragEvent.color || "#2dd4bf" }}
            />
            <div className="flex h-full flex-col items-center justify-center">
              <div className="w-full truncate text-center text-xs font-semibold text-ink">
                {dragEvent.title}
              </div>
              <div className="truncate text-[10.5px] font-medium tabular-nums text-ink-soft">
                {formatTime(
                  new Date(
                    new Date(days[drag.dayIndex]).setHours(0, drag.startMin, 0, 0)
                  )
                )}{" "}
                –{" "}
                {drag.endMin >= DAY_END * 60
                  ? "00:00"
                  : formatTime(
                      new Date(
                        new Date(days[drag.dayIndex]).setHours(0, drag.endMin, 0, 0)
                      )
                    )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Position (top/height) d'un événement dans la grille. */
function eventStyle(ev: EventItem) {
  const { startMin, endMin } = eventBounds(ev);
  const top = ((startMin - DAY_START * 60) / 60) * HOUR_PX;
  const height = Math.max(24, ((endMin - startMin) / 60) * HOUR_PX - 3);
  return { top: `${top}px`, height: `${height}px` };
}

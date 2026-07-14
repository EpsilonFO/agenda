"use client";

import { useEffect, useState } from "react";
import { EventItem } from "@/lib/types";
import { formatTime, parseIso, sameDay, weekdayShort } from "@/lib/dates";

const DAY_START = 7; // 7h
const DAY_END = 22; // 22h
const HOUR_PX = 56;
const EVENT_BASE = "#101d31"; // fond opaque de l'agenda

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
};

export default function Calendar({
  days,
  events,
  onEventClick,
  onSlotClick,
}: Props) {
  const hours = Array.from(
    { length: DAY_END - DAY_START },
    (_, i) => DAY_START + i
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

  function eventStyle(ev: EventItem) {
    const start = parseIso(ev.start);
    const end = parseIso(ev.end);
    const startMin = start.getHours() * 60 + start.getMinutes();
    const endMin = end.getHours() * 60 + end.getMinutes();
    const top = ((startMin - DAY_START * 60) / 60) * HOUR_PX;
    const height = Math.max(24, ((endMin - startMin) / 60) * HOUR_PX - 3);
    return { top: `${top}px`, height: `${height}px` };
  }

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
      <div className="relative flex-1 overflow-y-auto">
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
          {days.map((day) => {
            const isToday = sameDay(day, now);
            const dayEvents = events.filter((ev) =>
              sameDay(parseIso(ev.start), day)
            );
            return (
              <div
                key={day.toISOString()}
                className={`relative border-r border-line last:border-r-0 ${
                  isToday ? "bg-brand/[0.06]" : ""
                }`}
              >
                {hours.map((h) => (
                  <div
                    key={h}
                    style={{ height: HOUR_PX }}
                    className="group border-b border-line/70 transition-colors hover:bg-white/[0.04]"
                    onClick={() => {
                      const start = new Date(day);
                      start.setHours(h, 0, 0, 0);
                      onSlotClick(start);
                    }}
                  />
                ))}

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
                  return (
                    <button
                      key={ev.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick(ev);
                      }}
                      style={{
                        ...eventStyle(ev),
                        backgroundColor: blend(color, EVENT_BASE, 0.28),
                        borderColor: blend(color, EVENT_BASE, 0.55),
                      }}
                      className="animate-fade-in group absolute left-1.5 right-1.5 z-10 overflow-hidden rounded-xl border p-1.5 pl-2.5 text-left shadow-soft transition-all duration-200 hover:-translate-y-px hover:shadow-lift"
                    >
                      <span
                        className="absolute inset-y-1.5 left-1 w-1 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <div className="truncate text-xs font-semibold text-ink">
                        {ev.title}
                      </div>
                      <div className="truncate text-[10.5px] font-medium tabular-nums text-ink-soft">
                        {formatTime(parseIso(ev.start))} –{" "}
                        {formatTime(parseIso(ev.end))}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

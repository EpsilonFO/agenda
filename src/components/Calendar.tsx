"use client";

import { EventItem } from "@/lib/types";
import {
  addDays,
  formatTime,
  parseIso,
  sameDay,
  weekdayShort,
} from "@/lib/dates";

const DAY_START = 7; // 7h
const DAY_END = 22; // 22h
const HOUR_PX = 52;

type Props = {
  weekStart: Date;
  events: EventItem[];
  onEventClick: (event: EventItem) => void;
  onSlotClick: (start: Date) => void;
};

export default function Calendar({
  weekStart,
  events,
  onEventClick,
  onSlotClick,
}: Props) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const hours = Array.from(
    { length: DAY_END - DAY_START },
    (_, i) => DAY_START + i
  );
  const today = new Date();

  function eventStyle(ev: EventItem) {
    const start = parseIso(ev.start);
    const end = parseIso(ev.end);
    const startMin = start.getHours() * 60 + start.getMinutes();
    const endMin = end.getHours() * 60 + end.getMinutes();
    const top = ((startMin - DAY_START * 60) / 60) * HOUR_PX;
    const height = Math.max(22, ((endMin - startMin) / 60) * HOUR_PX - 2);
    return { top: `${top}px`, height: `${height}px` };
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-black/5 bg-surface shadow-soft">
      {/* En-tête des jours */}
      <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-black/5">
        <div className="border-r border-black/5" />
        {days.map((day) => {
          const isToday = sameDay(day, today);
          return (
            <div
              key={day.toISOString()}
              className="border-r border-black/5 px-2 py-2 text-center last:border-r-0"
            >
              <div className="text-[11px] font-medium uppercase tracking-wide text-ink-soft">
                {weekdayShort(day)}
              </div>
              <div
                className={`mx-auto mt-1 flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                  isToday ? "bg-brand text-white" : "text-ink"
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
        <div className="grid grid-cols-[56px_repeat(7,1fr)]">
          {/* Colonne des heures */}
          <div className="border-r border-black/5">
            {hours.map((h) => (
              <div
                key={h}
                style={{ height: HOUR_PX }}
                className="relative"
              >
                <span className="absolute -top-2 right-2 text-[11px] text-ink-soft">
                  {h}:00
                </span>
              </div>
            ))}
          </div>

          {/* Colonnes des jours */}
          {days.map((day) => {
            const dayEvents = events.filter((ev) =>
              sameDay(parseIso(ev.start), day)
            );
            return (
              <div
                key={day.toISOString()}
                className="relative border-r border-black/5 last:border-r-0"
              >
                {hours.map((h) => (
                  <div
                    key={h}
                    style={{ height: HOUR_PX }}
                    className="border-b border-black/5 transition-colors hover:bg-brand-soft/40"
                    onClick={() => {
                      const start = new Date(day);
                      start.setHours(h, 0, 0, 0);
                      onSlotClick(start);
                    }}
                  />
                ))}

                {dayEvents.map((ev) => (
                  <button
                    key={ev.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick(ev);
                    }}
                    style={{
                      ...eventStyle(ev),
                      borderLeftColor: ev.color || "#6366f1",
                      backgroundColor: `${ev.color || "#6366f1"}14`,
                    }}
                    className="animate-fade-in absolute left-1 right-1 overflow-hidden rounded-md border-l-[3px] px-2 py-1 text-left shadow-sm transition hover:shadow-md"
                  >
                    <div className="truncate text-xs font-semibold text-ink">
                      {ev.title}
                    </div>
                    <div className="truncate text-[10px] text-ink-soft">
                      {formatTime(parseIso(ev.start))} –{" "}
                      {formatTime(parseIso(ev.end))}
                    </div>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

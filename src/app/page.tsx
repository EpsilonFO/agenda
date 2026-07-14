"use client";

import { useCallback, useEffect, useState } from "react";
import Calendar from "@/components/Calendar";
import EventModal from "@/components/EventModal";
import AgentChat from "@/components/AgentChat";
import MemoryPanel from "@/components/MemoryPanel";
import { EventItem } from "@/lib/types";
import {
  addDays,
  formatRangeLabel,
  startOfWeek,
  toLocalIso,
} from "@/lib/dates";

export default function Home() {
  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeek(new Date())
  );
  const [events, setEvents] = useState<EventItem[]>([]);
  const [modalEvent, setModalEvent] = useState<Partial<EventItem> | null>(null);

  const loadEvents = useCallback(async () => {
    const res = await fetch("/api/events");
    setEvents(await res.json());
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  return (
    <main className="mx-auto flex h-screen max-w-[1500px] flex-col gap-4 p-4 lg:p-6">
      {/* Barre du haut */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight text-ink">
            🗓️ Mon agenda
          </h1>
          <span className="hidden text-sm text-ink-soft sm:inline">
            {formatRangeLabel(weekStart)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-black/10 bg-surface">
            <button
              onClick={() => setWeekStart((w) => addDays(w, -7))}
              className="px-3 py-1.5 text-ink-soft hover:text-ink"
              aria-label="Semaine précédente"
            >
              ‹
            </button>
            <button
              onClick={() => setWeekStart(startOfWeek(new Date()))}
              className="border-x border-black/10 px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-muted"
            >
              Aujourd&apos;hui
            </button>
            <button
              onClick={() => setWeekStart((w) => addDays(w, 7))}
              className="px-3 py-1.5 text-ink-soft hover:text-ink"
              aria-label="Semaine suivante"
            >
              ›
            </button>
          </div>

          <button
            onClick={() => {
              const start = new Date();
              start.setMinutes(0, 0, 0);
              start.setHours(start.getHours() + 1);
              setModalEvent({ start: toLocalIso(start) });
            }}
            className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand/90"
          >
            + Événement
          </button>
        </div>
      </header>

      {/* Corps : calendrier + panneau latéral */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <div className="min-h-0">
          <Calendar
            weekStart={weekStart}
            events={events}
            onEventClick={(ev) => setModalEvent(ev)}
            onSlotClick={(start) => {
              const end = new Date(start.getTime() + 3600000);
              setModalEvent({
                start: toLocalIso(start),
                end: toLocalIso(end),
              });
            }}
          />
        </div>

        <aside className="flex min-h-0 flex-col gap-4">
          <div className="min-h-0 flex-1">
            <AgentChat onChanged={loadEvents} />
          </div>
          <MemoryPanel />
        </aside>
      </div>

      {modalEvent && (
        <EventModal
          event={modalEvent}
          onClose={() => setModalEvent(null)}
          onSaved={() => {
            setModalEvent(null);
            loadEvents();
          }}
        />
      )}
    </main>
  );
}

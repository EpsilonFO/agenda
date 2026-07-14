"use client";

import { useCallback, useEffect, useState } from "react";
import Calendar from "@/components/Calendar";
import EventModal from "@/components/EventModal";
import AgentChat from "@/components/AgentChat";
import MobileAgentBar from "@/components/MobileAgentBar";
import MemoryPanel from "@/components/MemoryPanel";
import { EventItem } from "@/lib/types";
import {
  addDays,
  formatRangeLabel,
  startOfDay,
  startOfWeek,
  toLocalIso,
} from "@/lib/dates";
import { useAgentChat } from "@/lib/useAgentChat";

export default function Home() {
  // Nombre de jours affichés : 7 sur grand écran, 3 sur mobile (fenêtre
  // glissante confortable). `anchor` est le premier jour visible.
  const [viewDays, setViewDays] = useState(7);
  const [anchor, setAnchor] = useState<Date>(() => startOfWeek(new Date()));
  const [events, setEvents] = useState<EventItem[]>([]);
  const [modalEvent, setModalEvent] = useState<Partial<EventItem> | null>(null);

  const loadEvents = useCallback(async () => {
    const res = await fetch("/api/events");
    setEvents(await res.json());
  }, []);

  const chat = useAgentChat(loadEvents);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // Adapte le nombre de jours à la largeur d'écran (lg = 1024px).
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => {
      if (mq.matches) {
        setViewDays(7);
        setAnchor((a) => startOfWeek(a));
      } else {
        setViewDays(3);
        setAnchor((a) => startOfDay(a));
      }
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const days = Array.from({ length: viewDays }, (_, i) => addDays(anchor, i));

  function goToday() {
    setAnchor(viewDays === 7 ? startOfWeek(new Date()) : startOfDay(new Date()));
  }

  return (
    <main className="mx-auto flex h-screen max-w-[1500px] flex-col gap-4 p-4 pb-24 lg:p-6 lg:pb-6">
      {/* Barre du haut */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight text-ink">
            🗓️ Mon agenda
          </h1>
          <span className="hidden text-sm text-ink-soft sm:inline">
            {formatRangeLabel(anchor, viewDays)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-black/10 bg-surface">
            <button
              onClick={() => setAnchor((a) => addDays(a, -viewDays))}
              className="px-3 py-1.5 text-ink-soft hover:text-ink"
              aria-label="Période précédente"
            >
              ‹
            </button>
            <button
              onClick={goToday}
              className="border-x border-black/10 px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-muted"
            >
              Aujourd&apos;hui
            </button>
            <button
              onClick={() => setAnchor((a) => addDays(a, viewDays))}
              className="px-3 py-1.5 text-ink-soft hover:text-ink"
              aria-label="Période suivante"
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

      {/* Corps : calendrier + panneau latéral (bureau) */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <div className="min-h-0">
          <Calendar
            days={days}
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

        <aside className="hidden min-h-0 flex-col gap-4 lg:flex">
          <div className="min-h-0 flex-1">
            <AgentChat chat={chat} />
          </div>
          <MemoryPanel />
        </aside>
      </div>

      {/* Barre de prompt fixée en bas (mobile) */}
      <MobileAgentBar chat={chat} />

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

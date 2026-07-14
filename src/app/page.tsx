"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Calendar from "@/components/Calendar";
import EventModal from "@/components/EventModal";
import AgentChat from "@/components/AgentChat";
import MobileAgentBar from "@/components/MobileAgentBar";
import MemoryPanel from "@/components/MemoryPanel";
import SegmentedControl from "@/components/SegmentedControl";
import { EventItem } from "@/lib/types";
import {
  addDays,
  formatRangeLabel,
  startOfDay,
  startOfWeek,
  toLocalIso,
} from "@/lib/dates";
import { useAgentChat } from "@/lib/useAgentChat";

const VIEW_OPTIONS = [
  { value: 1, label: "1J" },
  { value: 3, label: "3J" },
  { value: 7, label: "7J" },
];

export default function Home() {
  // Nombre de jours affichés (1 / 3 / 7). Défaut responsive au 1er rendu,
  // puis pilotable par le sélecteur segmenté.
  const [viewDays, setViewDays] = useState(7);
  const [anchor, setAnchor] = useState<Date>(() => startOfWeek(new Date()));
  const [events, setEvents] = useState<EventItem[]>([]);
  const [modalEvent, setModalEvent] = useState<Partial<EventItem> | null>(null);
  const pickedRef = useRef(false);

  const loadEvents = useCallback(async () => {
    const res = await fetch("/api/events");
    setEvents(await res.json());
  }, []);

  const chat = useAgentChat(loadEvents);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // Défaut mobile : 3 jours centrés sur aujourd'hui.
  useEffect(() => {
    if (!pickedRef.current && window.matchMedia("(max-width: 1023px)").matches) {
      setViewDays(3);
      setAnchor(startOfDay(new Date()));
    }
  }, []);

  const days = Array.from({ length: viewDays }, (_, i) => addDays(anchor, i));

  function anchorFor(n: number, base: Date) {
    return n === 7 ? startOfWeek(base) : startOfDay(base);
  }

  function changeView(n: number) {
    pickedRef.current = true;
    setViewDays(n);
    // On recentre sur aujourd'hui au changement de vue (comportement attendu).
    setAnchor(anchorFor(n, new Date()));
  }

  function goToday() {
    setAnchor(anchorFor(viewDays, new Date()));
  }

  return (
    <main className="mx-auto flex h-screen max-w-[1560px] flex-col gap-4 p-3 pb-24 sm:p-4 lg:p-6 lg:pb-6">
      {/* Barre du haut */}
      <header className="glass flex flex-wrap items-center justify-between gap-3 rounded-3xl px-3 py-2.5 shadow-soft sm:px-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-brand-gradient text-base shadow-glow-sm">
            🗓️
          </div>
          <div className="leading-tight">
            <h1 className="font-display text-lg font-bold tracking-tight text-ink">
              Agenda
            </h1>
            <span className="hidden text-xs font-medium tabular-nums text-ink-soft sm:block">
              {formatRangeLabel(anchor, viewDays)}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            options={VIEW_OPTIONS}
            value={viewDays}
            onChange={changeView}
            ariaLabel="Nombre de jours affichés"
          />

          <div className="flex items-center overflow-hidden rounded-xl border border-line bg-white/70 shadow-soft backdrop-blur">
            <button
              onClick={() => setAnchor((a) => addDays(a, -viewDays))}
              className="px-3 py-2 text-ink-soft transition hover:bg-white hover:text-ink"
              aria-label="Période précédente"
            >
              ‹
            </button>
            <button
              onClick={goToday}
              className="border-x border-line px-3.5 py-2 text-sm font-semibold text-ink transition hover:bg-white"
            >
              Aujourd&apos;hui
            </button>
            <button
              onClick={() => setAnchor((a) => addDays(a, viewDays))}
              className="px-3 py-2 text-ink-soft transition hover:bg-white hover:text-ink"
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
            className="btn-primary"
          >
            <span className="text-base leading-none">+</span>
            <span className="hidden sm:inline">Événement</span>
          </button>
        </div>
      </header>

      {/* Corps : calendrier + panneau latéral (bureau) */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_368px]">
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

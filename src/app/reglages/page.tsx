"use client";

import Link from "next/link";
import { CalendarIcon } from "@/components/icons";
import NotificationSettings from "@/components/NotificationSettings";
import MobileTabBar from "@/components/MobileTabBar";

/**
 * Page réglages — reconstruite de zéro pendant la refonte v2 (PLAN.md, phase 6).
 * Les sections (lieux & clusters, travail, sport, sorties, cuisine, horaires)
 * arriveront une par une, chacune éditant data/life-config.json.
 * Seules les notifications, indépendantes du planificateur, restent actives.
 */
export default function ReglagesPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-4 pb-[8.5rem] sm:p-6 lg:pb-6">
      <header className="glass mt-[env(safe-area-inset-top)] flex items-center justify-between rounded-3xl px-4 py-3">
        <h1 className="font-display text-lg font-bold tracking-tight text-ink">
          Réglages
        </h1>
        <Link
          href="/"
          className="flex items-center gap-1.5 rounded-xl border border-line bg-white/[0.06] px-3 py-2 text-sm font-medium text-ink-soft shadow-soft backdrop-blur-md transition hover:bg-white/10 hover:text-ink"
        >
          <CalendarIcon size={16} />
          <span>Agenda</span>
        </Link>
      </header>

      <section className="glass rounded-3xl px-5 py-6 text-center">
        <p className="text-3xl">🚧</p>
        <h2 className="mt-2 font-display text-base font-bold text-ink">
          Réglages en reconstruction
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-soft">
          La refonte v2 est en cours : la configuration de vie (lieux, travail,
          sport, sorties, cuisine) sera reconstruite ici section par section.
          En attendant, elle s&apos;édite dans <code>data/life-config.json</code>.
        </p>
      </section>

      <NotificationSettings />

      <MobileTabBar />
    </main>
  );
}

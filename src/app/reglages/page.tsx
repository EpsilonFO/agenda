"use client";

import Link from "next/link";
import { CalendarIcon } from "@/components/icons";
import LifeConfigEditor from "@/components/LifeConfigEditor";
import NotificationSettings from "@/components/NotificationSettings";
import MobileTabBar from "@/components/MobileTabBar";

/**
 * Page réglages (v5) : édite data/life-config.json — la source de vérité
 * unique du planificateur déterministe. Chaque section reflète le schéma de
 * src/lib/planner/config.ts ; l'enregistrement revalide tout côté serveur.
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

      <LifeConfigEditor />

      <section className="glass rounded-3xl px-5 py-5">
        <h2 className="mb-3 font-display text-base font-bold tracking-tight text-ink">
          Notifications
        </h2>
        <NotificationSettings />
      </section>

      <MobileTabBar />
    </main>
  );
}

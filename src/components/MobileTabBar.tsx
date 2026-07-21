"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarIcon, SparkIcon, SettingsIcon } from "@/components/icons";

/** Hauteur du contenu de la barre (hors zone sûre). Utilisée aussi ailleurs. */
export const TAB_BAR_HEIGHT = "3.75rem";

const TABS = [
  { href: "/", label: "Agenda", Icon: CalendarIcon },
  { href: "/agents", label: "Agents", Icon: SparkIcon },
  { href: "/reglages", label: "Réglages", Icon: SettingsIcon },
];

/** Barre d'onglets fixée en bas (mobile uniquement). */
export default function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface-muted/90 backdrop-blur-2xl lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {TABS.map(({ href, label, Icon }) => {
        const active =
          href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition ${
              active ? "text-brand" : "text-ink-soft hover:text-ink"
            }`}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={21} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

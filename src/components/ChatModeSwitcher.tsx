"use client";

import { AGENT_META, AGENT_ORDER, type ChatMode } from "@/lib/agents";
import type { AgentChat } from "@/lib/useAgentChat";

/** Teal de marque : distingue le Conseil du violet de Josiane. */
const COUNCIL_COLOR = "#2dd4bf";

/** Titre + sous-titre affichés en tête du panneau selon le mode actif. */
export function chatModeInfo(mode: ChatMode): {
  title: string;
  subtitle: string;
  color: string;
} {
  if (mode === "council")
    return {
      title: "Planifier la semaine",
      subtitle: "Planification complète de la semaine",
      color: COUNCIL_COLOR,
    };
  const a = AGENT_META[mode];
  return { title: a.label, subtitle: a.role, color: a.color };
}

/**
 * Choix de l'interlocuteur : une pastille par agent, toutes visibles d'un coup
 * (plus de scroll horizontal). Seule l'active se déplie pour afficher son nom.
 *
 * Le Conseil n'y figure pas : il ne se convoque pas comme un agent, mais par le
 * bouton « Réunir le conseil » (bureau) ou depuis l'onglet Agents (mobile).
 */
export default function ChatModeSwitcher({ chat }: { chat: AgentChat }) {
  return (
    <div className="flex items-center gap-1.5">
      {AGENT_ORDER.map((name) => {
        const a = AGENT_META[name];
        const active = chat.mode === name;
        return (
          <button
            key={name}
            onClick={() => chat.setMode(name)}
            title={`${a.label} — ${a.role}`}
            aria-label={`${a.label} — ${a.role}`}
            aria-pressed={active}
            className={`group flex h-9 shrink-0 items-center rounded-full border transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
              active
                ? "gap-1.5 pl-1 pr-3"
                : "w-9 justify-center border-line hover:border-line-strong hover:bg-white/10"
            }`}
            style={
              active
                ? { borderColor: `${a.color}80`, backgroundColor: `${a.color}22` }
                : undefined
            }
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white transition-all duration-200 ${
                active ? "" : "opacity-65 group-hover:opacity-100"
              }`}
              style={{ backgroundColor: a.color }}
            >
              {a.label.charAt(0)}
            </span>
            {active && (
              <span className="whitespace-nowrap text-xs font-semibold text-ink">
                {a.label}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

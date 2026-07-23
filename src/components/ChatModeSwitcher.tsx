"use client";

import { AGENT_META, AGENT_ORDER, type ChatMode } from "@/lib/agents";
import type { AgentChat } from "@/lib/useAgentChat";

/** Titre + sous-titre affichés en tête du panneau selon le mode actif. */
export function chatModeInfo(mode: ChatMode): {
  title: string;
  subtitle: string;
  color: string;
} {
  if (mode === "council")
    return {
      title: "Séance du Conseil",
      subtitle: "Planification complète de la semaine",
      color: "#a855f7",
    };
  const a = AGENT_META[mode];
  return { title: a.label, subtitle: a.role, color: a.color };
}

/** Rangée de boutons pour choisir avec qui l'on discute. */
export default function ChatModeSwitcher({ chat }: { chat: AgentChat }) {
  const pill = "shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-medium transition";

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {AGENT_ORDER.map((name) => {
        const a = AGENT_META[name];
        const active = chat.mode === name;
        return (
          <button
            key={name}
            onClick={() => chat.setMode(name)}
            className={`${pill} inline-flex items-center gap-1.5 ${
              active ? "text-ink" : "border-line text-ink-soft hover:bg-white/10"
            }`}
            style={
              active
                ? { borderColor: a.color, backgroundColor: `${a.color}22` }
                : undefined
            }
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: a.color }}
            />
            {a.label}
          </button>
        );
      })}

      <button
        onClick={chat.startCouncil}
        className={`${pill} ${
          chat.mode === "council"
            ? "border-brand/50 bg-brand/15 text-brand"
            : "border-brand/40 text-brand hover:bg-brand/10"
        }`}
      >
        + Conseil
      </button>
    </div>
  );
}

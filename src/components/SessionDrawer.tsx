"use client";

import { useEffect, useRef } from "react";
import type { AgentChat } from "@/lib/useAgentChat";
import type { Session } from "@/lib/types";

function formatSessionDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return "Hier";
  if (diffDays < 7) return `Il y a ${diffDays} jours`;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

type Props = {
  chat: AgentChat;
  open: boolean;
  onClose: () => void;
};

export default function SessionDrawer({ chat, open, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Ferme le drawer en cliquant à l'extérieur.
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open, onClose]);

  // Ferme avec Escape.
  useEffect(() => {
    if (!open) return;
    function handle(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [open, onClose]);

  if (!open) return null;

  const { sessions, activeSession, loadSession, deleteSession } = chat;

  async function handleLoad(session: Session) {
    await loadSession(session);
    onClose();
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    await deleteSession(id);
  }

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-2xl border border-line bg-surface shadow-xl backdrop-blur-xl"
    >
      {/* Liste des sessions */}
      <div className="max-h-80 overflow-y-auto py-1 [scrollbar-width:thin]">
        {sessions.length === 0 ? (
          <p className="px-4 py-3 text-xs text-ink-soft">Aucune conversation archivée</p>
        ) : (
          sessions.map((s) => {
            const isActive = activeSession?.id === s.id;
            return (
              <button
                key={s.id}
                onClick={() => handleLoad(s)}
                className={`group flex w-full items-start gap-2 px-3 py-2.5 text-left transition hover:bg-white/[0.06] ${
                  isActive ? "bg-white/[0.08]" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-xs font-medium ${
                      isActive ? "text-ink" : "text-ink-soft"
                    }`}
                  >
                    {s.title}
                  </p>
                  <p className="mt-0.5 text-[10px] text-ink-soft/60">
                    {formatSessionDate(s.createdAt)}
                  </p>
                </div>
                {/* Bouton supprimer */}
                <button
                  onClick={(e) => handleDelete(e, s.id)}
                  className="mt-0.5 shrink-0 rounded-md p-0.5 text-ink-soft/40 opacity-0 transition hover:bg-white/10 hover:text-red-400 group-hover:opacity-100"
                  aria-label="Supprimer cette conversation"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2 2l8 8M10 2l-8 8"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

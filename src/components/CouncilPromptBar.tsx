"use client";

import { useRef, useEffect } from "react";
import MicButton from "@/components/MicButton";
import { AgentChat as AgentChatState } from "@/lib/useAgentChat";

interface Props {
  chat: AgentChatState;
  open: boolean;
  onClose: () => void;
}

/**
 * Barre de prompt "Réunir le conseil" — s'affiche sous le header desktop.
 * Pré-sélectionne le mode "council" à l'ouverture.
 */
export default function CouncilPromptBar({ chat, open, onClose }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Quand la barre s'ouvre, on bascule en mode conseil et on focus le champ
  useEffect(() => {
    if (open) {
      chat.setMode("council");
      setTimeout(() => textareaRef.current?.focus(), 60);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function submit() {
    if (!chat.input.trim()) return;
    chat.send();
    onClose();
  }

  if (!open) return null;

  return (
    <div className="glass animate-slide-down rounded-3xl px-4 py-3">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Icône conseil */}
          <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-brand-gradient text-brand-ink shadow-glow-sm">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="5" cy="5" r="2.5" />
              <circle cx="11" cy="5" r="2.5" />
              <path d="M1 13c0-2.2 1.8-4 4-4h6c2.2 0 4 1.8 4 4" strokeLinecap="round" />
            </svg>
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-ink">Séance du Conseil</div>
            <div className="text-[11px] text-ink-soft">Décris tes contraintes de la semaine</div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-xl border border-line text-ink-soft transition hover:bg-white/10 hover:text-ink"
          aria-label="Fermer"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="flex items-end gap-2">
        <MicButton
          onText={(t) => chat.setInput((prev) => (prev ? `${prev} ${t}` : t))}
          onError={() => {}}
        />
        <textarea
          ref={textareaRef}
          value={chat.input}
          onChange={(e) => chat.setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape") onClose();
          }}
          rows={2}
          placeholder="Ex : 10h Delos, TP jeudi, salle 3×, soirée Marine samedi…"
          className="field max-h-40 flex-1 resize-none"
        />
        <button
          onClick={submit}
          disabled={chat.loading || !chat.input.trim()}
          className="btn-primary h-10 w-11 px-0 text-base"
          aria-label="Lancer le conseil"
        >
          →
        </button>
      </div>

      {/* Suggestions rapides */}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {[
          "Organise ma semaine : 10h Delos, TP jeudi, salle 3×, soirée Marine",
          "Planifie la semaine prochaine, je suis chez mes parents le week-end",
        ].map((s) => (
          <button
            key={s}
            onClick={() => {
              chat.setInput(s);
              textareaRef.current?.focus();
            }}
            className="rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-[11px] font-medium text-brand transition hover:bg-brand/20"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

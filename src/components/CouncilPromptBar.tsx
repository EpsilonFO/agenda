"use client";

import { useRef, useEffect, useCallback } from "react";
import MicButton from "@/components/MicButton";
import { AgentChat as AgentChatState } from "@/lib/useAgentChat";
import type { ChatMode } from "@/lib/agents";

interface Props {
  chat: AgentChatState;
  open: boolean;
  onClose: () => void;
}

/**
 * Ouverture « Réunir le conseil » (bureau) : plein écran, fond flouté,
 * une seule question posée en grand et un champ de prompt large.
 * Pré-sélectionne le mode "council" à l'ouverture.
 */
export default function CouncilPromptBar({ chat, open, onClose }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Mode à rétablir si la séance est abandonnée sans être lancée.
  const fallbackModeRef = useRef<ChatMode>("josiane");

  // À l'ouverture : mémorise l'interlocuteur courant, bascule en mode conseil
  // et focus le champ. `send` capture le mode dans sa closure, d'où le bascule
  // dès l'ouverture plutôt qu'au moment de l'envoi.
  useEffect(() => {
    if (!open) return;
    fallbackModeRef.current = chat.mode === "council" ? "josiane" : chat.mode;
    chat.setMode("council");
    const t = setTimeout(() => textareaRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Fermeture sans lancer le conseil : le panneau repart sur Josiane. */
  const cancel = useCallback(() => {
    chat.setMode(fallbackModeRef.current);
    onClose();
  }, [chat, onClose]);

  // Échap ferme sans lancer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, cancel]);

  /** Lancement : on reste en mode conseil pour voir la délibération arriver. */
  function submit() {
    if (!chat.input.trim()) return;
    chat.send();
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center px-6"
      onClick={cancel}
    >
      {/* Fond complètement flouté */}
      <div className="absolute inset-0 bg-surface-muted/70 backdrop-blur-3xl backdrop-saturate-150" />

      <button
        onClick={cancel}
        className="btn-icon absolute right-6 top-6 z-10"
        aria-label="Fermer"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
        </svg>
      </button>

      <div
        className="animate-scale-in relative z-10 w-full max-w-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Bandeau « Séance du Conseil » */}
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-brand-gradient text-brand-ink shadow-glow-sm">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="5" cy="5" r="2.5" />
              <circle cx="11" cy="5" r="2.5" />
              <path d="M1 13c0-2.2 1.8-4 4-4h6c2.2 0 4 1.8 4 4" strokeLinecap="round" />
            </svg>
          </span>
          <span className="text-sm font-semibold uppercase tracking-[0.16em] text-ink-soft">
            Séance du Conseil
          </span>
        </div>

        {/* La question, en grand */}
        <h2 className="mb-8 text-balance text-center font-display text-4xl font-bold leading-tight tracking-tight text-ink sm:text-5xl">
          Quoi de prévu semaine pro ?
        </h2>

        {/* Grande barre de prompt */}
        <div className="glass-strong flex items-end gap-3 rounded-4xl p-3 pl-4">
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
            }}
            rows={2}
            placeholder="Ex : 10h Delos, TP jeudi, salle 3×, soirée Marine samedi…"
            className="max-h-56 flex-1 resize-none border-0 bg-transparent py-2 text-lg text-ink outline-none placeholder:text-ink-faint"
          />
          <button
            onClick={submit}
            disabled={chat.loading || !chat.input.trim()}
            className="btn-primary h-12 w-12 shrink-0 rounded-2xl px-0 text-xl"
            aria-label="Lancer le conseil"
          >
            →
          </button>
        </div>

        <p className="mt-5 text-center text-[11px] text-ink-faint">
          Entrée pour lancer · Échap pour fermer
        </p>
      </div>
    </div>
  );
}

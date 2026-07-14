"use client";

import { useEffect, useRef, useState } from "react";
import ChatMessages from "@/components/ChatMessages";
import { AgentChat as AgentChatState } from "@/lib/useAgentChat";

/**
 * Barre de prompt fixée en bas de l'écran (mobile).
 * Toujours accessible ; s'ouvre en une feuille plein écran pour afficher
 * la conversation. Masquée sur grand écran (barre latérale à la place).
 */
export default function MobileAgentBar({ chat }: { chat: AgentChatState }) {
  const [open, setOpen] = useState(false);
  const sheetInputRef = useRef<HTMLTextAreaElement>(null);
  const barInputRef = useRef<HTMLTextAreaElement>(null);

  // Ferme la feuille avec la touche Échap.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Donne le focus au champ de la feuille à l'ouverture.
  useEffect(() => {
    if (open) sheetInputRef.current?.focus();
  }, [open]);

  function submit() {
    if (!chat.input.trim()) return;
    chat.send();
    setOpen(true); // ouvre la feuille pour voir la réponse
  }

  const composer = (
    ref: React.RefObject<HTMLTextAreaElement>,
    { autoFocus = false, placeholder = "Demande à l'assistant…" } = {}
  ) => (
    <div className="flex items-end gap-2">
      <textarea
        ref={ref}
        value={chat.input}
        onChange={(e) => chat.setInput(e.target.value)}
        onFocus={() => !open && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={1}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className="max-h-32 flex-1 resize-none rounded-xl border border-black/10 bg-surface px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
      <button
        onClick={submit}
        disabled={chat.loading || !chat.input.trim()}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-base font-semibold text-white transition hover:bg-brand/90 disabled:opacity-40"
        aria-label="Envoyer"
      >
        →
      </button>
    </div>
  );

  return (
    <>
      {/* Feuille de conversation */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="animate-fade-in absolute inset-0 bg-ink/30 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div
            className="animate-slide-up absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-3xl border-t border-black/5 bg-surface shadow-panel"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex items-center justify-between border-b border-black/5 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-base">
                  ✨
                </span>
                <div>
                  <div className="text-sm font-semibold text-ink">
                    Assistant agenda
                  </div>
                  <div className="text-[11px] text-ink-soft">
                    Propulsé par Mistral
                  </div>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-ink-soft transition hover:bg-surface-muted hover:text-ink"
                aria-label="Fermer"
              >
                ×
              </button>
            </div>

            <ChatMessages chat={chat} />

            <div className="border-t border-black/5 p-3">
              {composer(sheetInputRef, { autoFocus: true })}
            </div>
          </div>
        </div>
      )}

      {/* Barre fixe en bas (masquée quand la feuille est ouverte) */}
      <div
        className={`fixed inset-x-0 bottom-0 z-30 border-t border-black/5 bg-surface/95 px-3 py-2.5 backdrop-blur lg:hidden ${
          open ? "hidden" : ""
        }`}
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.625rem)" }}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOpen(true)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-base"
            aria-label="Ouvrir la conversation"
          >
            ✨
          </button>
          {composer(barInputRef, { placeholder: "Demander à l'IA…" })}
        </div>
      </div>
    </>
  );
}

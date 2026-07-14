"use client";

import { useEffect, useRef, useState } from "react";
import ChatMessages from "@/components/ChatMessages";
import MicButton from "@/components/MicButton";
import { SparkIcon } from "@/components/icons";
import { AgentChat as AgentChatState } from "@/lib/useAgentChat";

/**
 * Barre de prompt fixée en bas de l'écran (mobile).
 * Toujours accessible ; s'ouvre en une feuille pour afficher la conversation.
 * Masquée sur grand écran (barre latérale à la place).
 */
export default function MobileAgentBar({ chat }: { chat: AgentChatState }) {
  const [open, setOpen] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const sheetInputRef = useRef<HTMLTextAreaElement>(null);
  const barInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) sheetInputRef.current?.focus();
  }, [open]);

  function submit() {
    if (!chat.input.trim()) return;
    chat.send();
    setOpen(true);
  }

  const dictate = (t: string) =>
    chat.setInput((prev) => (prev ? `${prev} ${t}` : t));

  const composer = (
    ref: React.RefObject<HTMLTextAreaElement>,
    { autoFocus = false, placeholder = "Demande à l'assistant…" } = {}
  ) => (
    <div className="flex items-end gap-2">
      <MicButton onText={dictate} onError={setMicError} />
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
        className="field max-h-32 flex-1 resize-none"
      />
      <button
        onClick={submit}
        disabled={chat.loading || !chat.input.trim()}
        className="btn-primary h-10 w-11 px-0 text-base"
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
            className="animate-fade-in absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div
            className="glass-strong animate-slide-up absolute inset-x-0 bottom-0 flex max-h-[86vh] flex-col rounded-t-4xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            {/* Poignée */}
            <div className="flex justify-center pt-2.5">
              <span className="h-1.5 w-10 rounded-full bg-ink-faint/40" />
            </div>

            <div className="flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-brand-gradient text-brand-ink shadow-glow-sm">
                  <SparkIcon size={17} />
                </span>
                <div className="leading-tight">
                  <div className="text-sm font-semibold text-ink">
                    Assistant agenda
                  </div>
                  <div className="text-[11px] text-ink-soft">
                    Propulsé par Mistral · dictée locale
                  </div>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="btn-icon"
                aria-label="Fermer"
              >
                ×
              </button>
            </div>

            <div className="border-t border-line" />
            <ChatMessages chat={chat} />

            <div className="border-t border-line p-3">
              {micError && (
                <p className="mb-2 px-1 text-[11px] font-medium text-red-500">
                  {micError}
                </p>
              )}
              {composer(sheetInputRef, { autoFocus: true })}
            </div>
          </div>
        </div>
      )}

      {/* Barre fixe en bas (masquée quand la feuille est ouverte) */}
      <div
        className={`fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/[0.06] px-3 pt-2.5 backdrop-blur-2xl lg:hidden ${
          open ? "hidden" : ""
        }`}
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.625rem)" }}
      >
        {micError && (
          <p className="mb-2 px-1 text-[11px] font-medium text-red-500">
            {micError}
          </p>
        )}
        {composer(barInputRef, { placeholder: "Demander à l'IA…" })}
      </div>
    </>
  );
}

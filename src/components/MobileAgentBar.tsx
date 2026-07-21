"use client";

import { useRef, useState } from "react";
import MicButton from "@/components/MicButton";
import ChatSheet from "@/components/ChatSheet";
import { AgentChat as AgentChatState } from "@/lib/useAgentChat";

/**
 * Barre de prompt de l'agenda, fixée juste au-dessus de la barre d'onglets (mobile).
 * Parle toujours à l'assistant agenda de base : pas de sélecteur ni de nom d'agent.
 * Les agents nommés vivent dans l'onglet « Agents ».
 */
export default function MobileAgentBar({ chat }: { chat: AgentChatState }) {
  const [open, setOpen] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const barInputRef = useRef<HTMLTextAreaElement>(null);

  function submit() {
    if (!chat.input.trim()) return;
    chat.send();
    setOpen(true);
  }

  const dictate = (t: string) =>
    chat.setInput((prev) => (prev ? `${prev} ${t}` : t));

  return (
    <>
      <ChatSheet
        chat={chat}
        open={open}
        onClose={() => setOpen(false)}
        header={{
          title: "Assistant",
          subtitle: "Agenda · ajout · déplacement · suppression",
          color: "#2dd4bf",
        }}
      />

      {/* Barre fixe, posée au-dessus de la barre d'onglets (masquée quand la feuille est ouverte) */}
      <div
        className={`fixed inset-x-0 z-30 border-t border-line bg-surface-muted/90 px-3 pb-2.5 pt-2.5 backdrop-blur-2xl lg:hidden ${
          open ? "hidden" : ""
        }`}
        style={{ bottom: "calc(3.75rem + env(safe-area-inset-bottom))" }}
      >
        {micError && (
          <p className="mb-2 px-1 text-[11px] font-medium text-red-500">
            {micError}
          </p>
        )}
        <div className="flex items-end gap-2">
          <MicButton onText={dictate} onError={setMicError} />
          <textarea
            ref={barInputRef}
            value={chat.input}
            onChange={(e) => chat.setInput(e.target.value)}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Demander à l'agenda…"
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
      </div>
    </>
  );
}

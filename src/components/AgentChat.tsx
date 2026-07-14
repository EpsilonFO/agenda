"use client";

import { useState } from "react";
import ChatMessages from "@/components/ChatMessages";
import MicButton from "@/components/MicButton";
import { AgentChat as AgentChatState } from "@/lib/useAgentChat";

/** Panneau de conversation (vue bureau, dans la barre latérale). */
export default function AgentChat({ chat }: { chat: AgentChatState }) {
  const [micError, setMicError] = useState<string | null>(null);

  return (
    <div className="panel flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-line bg-white/40 px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-brand-gradient text-base shadow-glow-sm">
          ✨
        </span>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-ink">Assistant agenda</div>
          <div className="text-[11px] text-ink-soft">
            Propulsé par Mistral · dictée locale
          </div>
        </div>
      </div>

      <ChatMessages chat={chat} />

      <div className="border-t border-line bg-white/40 p-3">
        {micError && (
          <p className="mb-2 px-1 text-[11px] font-medium text-red-500">
            {micError}
          </p>
        )}
        <div className="flex items-end gap-2">
          <MicButton
            onText={(t) =>
              chat.setInput((prev) => (prev ? `${prev} ${t}` : t))
            }
            onError={setMicError}
          />
          <textarea
            value={chat.input}
            onChange={(e) => chat.setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                chat.send();
              }
            }}
            rows={1}
            placeholder="Demande à l'assistant…"
            className="field max-h-32 flex-1 resize-none"
          />
          <button
            onClick={() => chat.send()}
            disabled={chat.loading || !chat.input.trim()}
            className="btn-primary h-10 w-11 px-0 text-base"
            aria-label="Envoyer"
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}

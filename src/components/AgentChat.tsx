"use client";

import { useState } from "react";
import ChatMessages from "@/components/ChatMessages";
import MicButton from "@/components/MicButton";
import ChatModeSwitcher, { chatModeInfo } from "@/components/ChatModeSwitcher";
import { AgentChat as AgentChatState } from "@/lib/useAgentChat";

/** Panneau de conversation (vue bureau, dans la barre latérale). */
export default function AgentChat({ chat }: { chat: AgentChatState }) {
  const [micError, setMicError] = useState<string | null>(null);
  const info = chatModeInfo(chat.mode);

  return (
    <div className="panel flex h-full flex-col overflow-hidden">
      <div className="border-b border-line bg-white/[0.04] px-4 py-3">
        <div className="mb-2.5 flex items-center gap-2.5">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-2xl text-white shadow-glow-sm"
            style={{ backgroundColor: info.color }}
          >
            <span className="text-sm font-bold">{info.title.charAt(0)}</span>
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-ink">{info.title}</div>
            <div className="text-[11px] text-ink-soft">{info.subtitle}</div>
          </div>
        </div>
        <ChatModeSwitcher chat={chat} />
      </div>

      <ChatMessages chat={chat} />

      <div className="border-t border-line bg-white/[0.04] p-3">
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

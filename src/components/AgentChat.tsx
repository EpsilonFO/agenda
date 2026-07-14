"use client";

import ChatMessages from "@/components/ChatMessages";
import { AgentChat as AgentChatState } from "@/lib/useAgentChat";

/** Panneau de conversation (vue bureau, dans la barre latérale). */
export default function AgentChat({ chat }: { chat: AgentChatState }) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-black/5 bg-surface shadow-soft">
      <div className="flex items-center gap-2 border-b border-black/5 px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-base">
          ✨
        </span>
        <div>
          <div className="text-sm font-semibold text-ink">Assistant agenda</div>
          <div className="text-[11px] text-ink-soft">Propulsé par Mistral</div>
        </div>
      </div>

      <ChatMessages chat={chat} />

      <div className="border-t border-black/5 p-3">
        <div className="flex items-end gap-2">
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
            className="max-h-32 flex-1 resize-none rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          <button
            onClick={() => chat.send()}
            disabled={chat.loading || !chat.input.trim()}
            className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:opacity-40"
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}

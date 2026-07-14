"use client";

import { useEffect, useRef } from "react";
import { AgentChat, CHAT_SUGGESTIONS } from "@/lib/useAgentChat";

/** Fil de discussion (messages + indicateur de saisie + suggestions). */
export default function ChatMessages({ chat }: { chat: AgentChat }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chat.messages, chat.loading]);

  return (
    <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
      {chat.messages.map((m, i) => (
        <div
          key={i}
          className={`flex ${
            m.role === "user" ? "justify-end" : "justify-start"
          }`}
        >
          <div
            className={`animate-fade-in max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
              m.role === "user"
                ? "bg-brand text-white"
                : "bg-surface-muted text-ink"
            }`}
          >
            <p className="whitespace-pre-wrap">{m.content}</p>
            {m.actions && m.actions.length > 0 && (
              <ul className="mt-2 space-y-1 border-t border-black/5 pt-2">
                {m.actions.map((a, j) => (
                  <li key={j} className="text-[11px] text-ink-soft">
                    ✓ {a}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ))}

      {chat.loading && (
        <div className="flex justify-start">
          <div className="rounded-2xl bg-surface-muted px-4 py-3">
            <div className="flex gap-1">
              <span className="h-2 w-2 animate-bounce rounded-full bg-ink-soft/50 [animation-delay:-0.3s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-ink-soft/50 [animation-delay:-0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-ink-soft/50" />
            </div>
          </div>
        </div>
      )}

      {chat.messages.length <= 1 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {CHAT_SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => chat.send(s)}
              className="rounded-full border border-black/10 px-3 py-1.5 text-[11px] text-ink-soft transition hover:border-brand hover:text-brand"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

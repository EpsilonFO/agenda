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
            className={`animate-fade-in max-w-[86%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
              m.role === "user"
                ? "rounded-br-md bg-brand-gradient text-white shadow-glow-sm"
                : "rounded-bl-md border border-line bg-white/80 text-ink shadow-soft"
            }`}
          >
            <p className="whitespace-pre-wrap">{m.content}</p>
            {m.actions && m.actions.length > 0 && (
              <ul className="mt-2 space-y-1 border-t border-white/25 pt-2">
                {m.actions.map((a, j) => (
                  <li
                    key={j}
                    className={`text-[11px] ${
                      m.role === "user" ? "text-white/[0.85]" : "text-ink-soft"
                    }`}
                  >
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
          <div className="rounded-2xl rounded-bl-md border border-line bg-white/80 px-4 py-3 shadow-soft">
            <div className="flex gap-1">
              <span className="h-2 w-2 animate-bounce rounded-full bg-accent/60 [animation-delay:-0.3s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-accent/60 [animation-delay:-0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-accent/60" />
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
              className="rounded-full border border-line bg-white/70 px-3 py-1.5 text-[11px] font-medium text-ink-soft shadow-soft transition-all duration-200 hover:-translate-y-px hover:border-brand/40 hover:text-brand hover:shadow-glow-sm"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

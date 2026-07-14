"use client";

import { useEffect, useRef, useState } from "react";

type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  actions?: string[];
};

const SUGGESTIONS = [
  "Bloque 2h de deep work demain matin",
  "Organise ma semaine : sport 3x, courses, dentiste jeudi",
  "Déplace ma réunion de 14h à jeudi",
];

export default function AgentChat({ onChanged }: { onChanged: () => void }) {
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      role: "assistant",
      content:
        "Bonjour 👋 Je gère ton agenda. Dis-moi ce que tu veux planifier, déplacer ou supprimer, et je m'occupe des créneaux.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    setInput("");

    const history = [...messages, { role: "user" as const, content }];
    setMessages(history);
    setLoading(true);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply || "…",
          actions: data.actions,
        },
      ]);
      if (data.changed) onChanged();
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "❌ Impossible de contacter l'agent." },
      ]);
    } finally {
      setLoading(false);
    }
  }

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

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m, i) => (
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
        {loading && (
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
      </div>

      {messages.length <= 1 && (
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="rounded-full border border-black/10 px-3 py-1.5 text-[11px] text-ink-soft transition hover:border-brand hover:text-brand"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="border-t border-black/5 p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Demande à l'assistant…"
            className="max-h-32 flex-1 resize-none rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          <button
            onClick={() => send()}
            disabled={loading || !input.trim()}
            className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:opacity-40"
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}

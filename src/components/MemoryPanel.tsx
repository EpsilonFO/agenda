"use client";

import { useEffect, useState } from "react";
import { MemoryItem } from "@/lib/types";

export default function MemoryPanel() {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(true);

  async function load() {
    const res = await fetch("/api/memory");
    setItems(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function add() {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    load();
  }

  async function remove(id: string) {
    await fetch(`/api/memory/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="rounded-2xl border border-black/5 bg-surface p-4 shadow-soft">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
          <span>🧠</span> Mémoire &amp; préférences
        </span>
        <span className="text-ink-soft">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="mt-3 animate-fade-in">
          <p className="mb-3 text-xs leading-relaxed text-ink-soft">
            Indique ici tes préférences récurrentes. L&apos;assistant en tient
            compte à chaque planification.
          </p>

          <div className="mb-3 flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="Ex : pas de réunion avant 9h"
              className="flex-1 rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            <button
              onClick={add}
              className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand/90"
            >
              +
            </button>
          </div>

          {items.length === 0 ? (
            <p className="text-xs italic text-ink-soft">
              Aucune préférence pour l&apos;instant.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {items.map((m) => (
                <li
                  key={m.id}
                  className="group flex items-start justify-between gap-2 rounded-lg bg-surface-muted px-3 py-2"
                >
                  <span className="text-xs leading-relaxed text-ink">
                    {m.content}
                  </span>
                  <button
                    onClick={() => remove(m.id)}
                    className="text-ink-soft opacity-0 transition group-hover:opacity-100 hover:text-red-500"
                    aria-label="Supprimer"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

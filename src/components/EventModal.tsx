"use client";

import { useEffect, useState } from "react";
import { EventItem } from "@/lib/types";
import { toLocalIso, parseIso } from "@/lib/dates";

type Props = {
  event: Partial<EventItem> | null;
  onClose: () => void;
  onSaved: () => void;
};

const CATEGORIES = ["travail", "perso", "sport", "santé", "famille", "loisir"];

/** transforme une Date en valeur pour <input type="datetime-local"> */
function toInputValue(iso?: string): string {
  if (!iso) return "";
  const d = parseIso(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export default function EventModal({ event, onClose, onSaved }: Props) {
  const isEdit = Boolean(event?.id);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [category, setCategory] = useState("travail");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!event) return;
    setTitle(event.title || "");
    setStart(toInputValue(event.start));
    setEnd(
      toInputValue(
        event.end ||
          (event.start
            ? toLocalIso(new Date(parseIso(event.start).getTime() + 3600000))
            : undefined)
      )
    );
    setCategory(event.category || "travail");
    setDescription(event.description || "");
    setLocation(event.location || "");
  }, [event]);

  if (!event) return null;

  async function save() {
    if (!title.trim() || !start || !end) return;
    setSaving(true);
    const payload = {
      title: title.trim(),
      start: toLocalIso(new Date(start)),
      end: toLocalIso(new Date(end)),
      category,
      description: description.trim() || undefined,
      location: location.trim() || undefined,
    };
    const url = isEdit ? `/api/events/${event!.id}` : "/api/events";
    const method = isEdit ? "PUT" : "POST";
    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    onSaved();
  }

  async function remove() {
    if (!isEdit) return;
    setSaving(true);
    await fetch(`/api/events/${event!.id}`, { method: "DELETE" });
    setSaving(false);
    onSaved();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="animate-fade-in w-full max-w-md rounded-2xl bg-surface p-6 shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-ink">
          {isEdit ? "Modifier l'événement" : "Nouvel événement"}
        </h2>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-ink-soft">
            Titre
          </span>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex : Point équipe"
            className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </label>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-soft">
              Début
            </span>
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-soft">
              Fin
            </span>
            <input
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-soft">
              Catégorie
            </span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-soft">
              Lieu
            </span>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Optionnel"
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>
        </div>

        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium text-ink-soft">
            Notes
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Optionnel"
            className="w-full resize-none rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </label>

        <div className="flex items-center justify-between">
          {isEdit ? (
            <button
              onClick={remove}
              disabled={saving}
              className="text-sm font-medium text-red-500 hover:text-red-600 disabled:opacity-50"
            >
              Supprimer
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-ink-soft hover:bg-surface-muted"
            >
              Annuler
            </button>
            <button
              onClick={save}
              disabled={saving || !title.trim()}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand/90 disabled:opacity-50"
            >
              {saving ? "…" : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

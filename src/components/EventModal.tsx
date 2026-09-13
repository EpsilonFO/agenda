"use client";

import { useEffect, useMemo, useState } from "react";
import { Attendee, AttendeeResponse, ChecklistItem, EventItem } from "@/lib/types";
import { toLocalIso, parseIso } from "@/lib/dates";
import { extractLinks } from "@/lib/links";
import { CHECKLIST_MAX_ITEMS, newChecklistItem } from "@/lib/checklist";
import { CheckIcon, LinkIcon, VideoIcon } from "@/components/icons";

type Props = {
  event: Partial<EventItem> | null;
  onClose: () => void;
  onSaved: () => void;
};

type GoogleAccountLite = {
  id: string;
  email: string;
  push: boolean;
  status: "ok" | "reauth" | "error";
};

const CATEGORIES = [
  "travail",
  "perso",
  "sport",
  "santé",
  "famille",
  "loisir",
  "trajet",
];

const RESPONSE_LABEL: Record<AttendeeResponse, string> = {
  accepted: "accepté",
  declined: "refusé",
  tentative: "peut-être",
  needsAction: "en attente",
};
const RESPONSE_DOT: Record<AttendeeResponse, string> = {
  accepted: "bg-emerald-400",
  declined: "bg-red-400",
  tentative: "bg-amber-400",
  needsAction: "bg-white/30",
};

/** transforme une Date en valeur pour <input type="datetime-local"> */
function toInputValue(iso?: string): string {
  if (!iso) return "";
  const d = parseIso(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function parseEmails(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,;\s]+/)) {
    const email = raw.trim().replace(/^<|>$/g, "").toLowerCase();
    if (email.includes("@") && !seen.has(email)) {
      seen.add(email);
      out.push(email);
    }
  }
  return out;
}

export default function EventModal({ event, onClose, onSaved }: Props) {
  const isEdit = Boolean(event?.id);
  // Événement importé de Google Calendar (invitation reçue, créé dans Google).
  const isGoogle = event?.source === "google" && Boolean(event?.google);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [category, setCategory] = useState("travail");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [checklistDraft, setChecklistDraft] = useState("");
  const [attendeesText, setAttendeesText] = useState("");
  const [inviteAccountId, setInviteAccountId] = useState("");
  const [accounts, setAccounts] = useState<GoogleAccountLite[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
    setChecklist((event.checklist || []).map((item) => ({ ...item })));
    setChecklistDraft("");
    setAttendeesText(
      (event.attendees || [])
        .filter((a) => !a.self)
        .map((a) => a.email)
        .join(", ")
    );
    setInviteAccountId(event.invite?.accountId || "");
    setError("");
  }, [event]);

  // Comptes Google connectés (pour proposer le champ « Invités »).
  useEffect(() => {
    let alive = true;
    fetch("/api/google/accounts")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        const list: GoogleAccountLite[] = d?.configured ? d.accounts || [] : [];
        setAccounts(list);
      })
      .catch(() => alive && setAccounts([]));
    return () => {
      alive = false;
    };
  }, []);

  // Liens écrits dans les notes ou le lieu (visio, doc partagé) : cliquables
  // au lieu d'être recopiés à la main. Recalculés à la frappe.
  const links = useMemo(() => extractLinks(description, location), [description, location]);

  const inviteAccounts = (accounts || []).filter((a) => a.push && a.status !== "reauth");
  const canInvite = inviteAccounts.length > 0 && !isGoogle;
  const effectiveInviteAccount =
    inviteAccounts.find((a) => a.id === inviteAccountId) || inviteAccounts[0];

  if (!event) return null;

  /** La checklist telle qu'elle part au serveur — entrée en cours de saisie comprise :
   *  taper « appeler Ismael » puis Enregistrer ne doit pas la perdre. */
  function checklistToSave(): ChecklistItem[] {
    const draft = checklistDraft.trim();
    const items = checklist.filter((i) => i.text.trim());
    return draft ? [...items, newChecklistItem(draft)] : items;
  }

  function addChecklistItem() {
    const text = checklistDraft.trim();
    if (!text || checklist.length >= CHECKLIST_MAX_ITEMS) return;
    setChecklist((list) => [...list, newChecklistItem(text)]);
    setChecklistDraft("");
  }

  async function save() {
    if (!title.trim() || !start || !end) return;
    setSaving(true);
    setError("");
    const payload: Record<string, unknown> = {
      title: title.trim(),
      start: toLocalIso(new Date(start)),
      end: toLocalIso(new Date(end)),
      category,
      description: description.trim() || undefined,
      location: location.trim() || undefined,
      checklist: checklistToSave(),
    };
    // Le champ Invités n'est envoyé que s'il est éditable ici : un événement
    // importé garde la liste d'invités de Google.
    if (canInvite) {
      payload.attendees = parseEmails(attendeesText);
      if (effectiveInviteAccount) payload.inviteAccountId = effectiveInviteAccount.id;
    }
    const url = isEdit ? `/api/events/${event!.id}` : "/api/events";
    const method = isEdit ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Enregistrement impossible.");
      return;
    }
    onSaved();
  }

  async function remove() {
    if (!isEdit) return;
    setSaving(true);
    await fetch(`/api/events/${event!.id}`, { method: "DELETE" });
    setSaving(false);
    onSaved();
  }

  async function rsvp(response: AttendeeResponse) {
    if (!isEdit) return;
    setSaving(true);
    setError("");
    const res = await fetch("/api/google/rsvp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: event!.id, response }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Réponse impossible.");
      return;
    }
    onSaved();
  }

  const organizer = event.google?.organizer;
  const myResponse = event.google?.myResponse;
  const attendeeList: Attendee[] = event.attendees || [];
  const pendingEmails = canInvite ? parseEmails(attendeesText) : [];

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="glass-strong animate-scale-in max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-4xl p-6 sm:rounded-4xl"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      >
        <h2 className="mb-5 font-display text-lg font-bold tracking-tight text-ink">
          {isEdit ? "Modifier l'événement" : "Nouvel événement"}
        </h2>

        {isGoogle && (
          <div className="mb-4 rounded-2xl border border-line bg-white/[0.04] px-3.5 py-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-ink">Google Calendar</span>
              {event.google?.htmlLink && (
                <a
                  href={event.google.htmlLink}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-brand hover:underline"
                >
                  Ouvrir dans Google
                </a>
              )}
            </div>
            {organizer && (
              <p className="mt-1 text-ink-soft">
                Organisé par {organizer.displayName || organizer.email}
                {organizer.self ? " (toi)" : ""}
              </p>
            )}
            {myResponse && (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-ink-faint">Ta réponse :</span>
                {(["accepted", "tentative", "declined"] as AttendeeResponse[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => rsvp(r)}
                    disabled={saving}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold capitalize transition disabled:opacity-50 ${
                      myResponse === r
                        ? "border-brand/60 bg-brand/15 text-brand"
                        : "border-line text-ink-soft hover:bg-white/10 hover:text-ink"
                    }`}
                  >
                    {RESPONSE_LABEL[r]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <label className="mb-3 block">
          <span className="field-label">Titre</span>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex : Point équipe"
            className="field"
          />
        </label>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="field-label">Début</span>
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="field"
            />
          </label>
          <label className="block">
            <span className="field-label">Fin</span>
            <input
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="field"
            />
          </label>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="field-label">Catégorie</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="field"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              {!CATEGORIES.includes(category) && (
                <option value={category}>{category}</option>
              )}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Lieu</span>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Optionnel"
              className="field"
            />
          </label>
        </div>

        <label className="mb-3 block">
          <span className="field-label">Notes</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Optionnel"
            className="field resize-none"
          />
        </label>

        {/* Liens repérés dans les notes ou le lieu : un lien de réunion se
            clique, il ne se copie-colle pas. */}
        {links.length > 0 && (
          <div className="-mt-1 mb-3 flex flex-wrap gap-1.5">
            {links.map((l) => (
              <a
                key={l.url}
                href={l.url}
                target="_blank"
                rel="noreferrer"
                title={l.url}
                className={`inline-flex max-w-full items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition ${
                  l.meeting
                    ? "border-brand/50 bg-brand/15 text-brand hover:bg-brand/25"
                    : "border-line bg-white/[0.05] text-ink-soft hover:bg-white/10 hover:text-ink"
                }`}
              >
                {l.meeting ? <VideoIcon size={13} /> : <LinkIcon size={13} />}
                <span className="truncate">
                  {l.meeting ? `Rejoindre · ${l.host}` : l.label}
                </span>
              </a>
            ))}
          </div>
        )}

        {/* Checklist : ce qu'il faut penser à faire PENDANT l'événement, plutôt
            qu'un événement voisin à caser à une heure précise. */}
        <div className="mb-3">
          <span className="field-label">À faire pendant</span>
          {checklist.length > 0 && (
            <ul className="mb-2 flex flex-col gap-1.5">
              {checklist.map((item, i) => (
                <li
                  key={item.id}
                  className="flex items-center gap-2 rounded-xl border border-line bg-white/[0.04] px-2.5 py-1.5"
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={item.done}
                    aria-label={item.done ? "Décocher" : "Cocher"}
                    onClick={() =>
                      setChecklist((list) =>
                        list.map((it, j) => (j === i ? { ...it, done: !it.done } : it))
                      )
                    }
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                      item.done
                        ? "border-brand/60 bg-brand/25 text-brand"
                        : "border-line-strong text-transparent hover:bg-white/10"
                    }`}
                  >
                    <CheckIcon size={12} />
                  </button>
                  <input
                    value={item.text}
                    onChange={(e) =>
                      setChecklist((list) =>
                        list.map((it, j) => (j === i ? { ...it, text: e.target.value } : it))
                      )
                    }
                    className={`min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint ${
                      item.done ? "text-ink-faint line-through" : "text-ink"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setChecklist((list) => list.filter((_, j) => j !== i))}
                    aria-label="Retirer"
                    className="shrink-0 rounded-lg px-1.5 py-0.5 text-ink-faint transition hover:bg-red-500/10 hover:text-red-300"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              value={checklistDraft}
              onChange={(e) => setChecklistDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addChecklistItem();
                }
              }}
              placeholder="Ex : appeler Ismael"
              className="field min-w-0 flex-1"
            />
            <button
              type="button"
              onClick={addChecklistItem}
              disabled={!checklistDraft.trim()}
              className="btn-ghost shrink-0 disabled:opacity-40"
            >
              Ajouter
            </button>
          </div>
          <span className="mt-1 block text-[11px] leading-snug text-ink-faint">
            Les cases encore à cocher remontent dans le rappel de l&apos;événement.
          </span>
        </div>

        {canInvite && (
          <label className="mb-3 block">
            <span className="field-label">Invités</span>
            <input
              value={attendeesText}
              onChange={(e) => setAttendeesText(e.target.value)}
              placeholder="emails séparés par des virgules"
              className="field"
              inputMode="email"
              autoCapitalize="none"
            />
            {inviteAccounts.length > 1 ? (
              <span className="mt-1.5 flex items-center gap-2 text-[11px] text-ink-faint">
                <span className="shrink-0">Invitation envoyée depuis</span>
                <select
                  value={effectiveInviteAccount?.id || ""}
                  onChange={(e) => setInviteAccountId(e.target.value)}
                  className="field !py-1 text-xs"
                >
                  {inviteAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.email}
                    </option>
                  ))}
                </select>
              </span>
            ) : (
              <span className="mt-1 block text-[11px] leading-snug text-ink-faint">
                {pendingEmails.length > 0
                  ? `Une invitation Google Calendar leur sera envoyée depuis ${effectiveInviteAccount?.email}.`
                  : `Ajoute des emails pour envoyer une invitation Google Calendar (depuis ${effectiveInviteAccount?.email}).`}
              </span>
            )}
          </label>
        )}

        {attendeeList.length > 0 && (
          <div className="mb-4 rounded-2xl border border-line bg-white/[0.03] px-3.5 py-2.5">
            <div className="mb-1.5 flex items-center justify-between text-[11px]">
              <span className="font-semibold uppercase tracking-wide text-ink-soft">
                {isGoogle ? "Participants" : "Réponses"}
              </span>
              {!isGoogle && event.invite?.htmlLink && (
                <a
                  href={event.invite.htmlLink}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-brand hover:underline"
                >
                  Voir dans Google
                </a>
              )}
              {!isGoogle && !event.invite?.sentAt && (
                <span className="text-ink-faint">invitation en cours d&apos;envoi</span>
              )}
            </div>
            <ul className="flex flex-col gap-1">
              {attendeeList.map((a) => {
                const status: AttendeeResponse = a.responseStatus || "needsAction";
                return (
                  <li key={a.email} className="flex items-center gap-2 text-xs text-ink-soft">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${RESPONSE_DOT[status]}`} />
                    <span className="truncate">
                      {a.displayName ? `${a.displayName} · ` : ""}
                      {a.email}
                      {a.self ? " (toi)" : ""}
                      {a.organizer ? " · organisateur" : ""}
                    </span>
                    <span className="ml-auto shrink-0 text-ink-faint">{RESPONSE_LABEL[status]}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {error && (
          <p className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        <div className="flex items-center justify-between">
          {isEdit ? (
            <button
              onClick={remove}
              disabled={saving}
              className="rounded-xl px-3 py-2 text-sm font-semibold text-red-500 transition hover:bg-red-500/10 disabled:opacity-50"
              title={
                isGoogle
                  ? "Retire aussi l'événement de ton Google Calendar (l'organisateur est prévenu)"
                  : undefined
              }
            >
              {isGoogle ? "Retirer de mon agenda" : "Supprimer"}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">
              Annuler
            </button>
            <button
              onClick={save}
              disabled={saving || !title.trim()}
              className="btn-primary"
            >
              {saving ? "…" : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

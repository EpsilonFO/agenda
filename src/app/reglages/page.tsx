"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarIcon, PinIcon } from "@/components/icons";
import type {
  Place,
  TravelTime,
  Activity,
  TransportProfile,
  WorkStream,
  Task,
} from "@/lib/types";

const MODES = ["à pied", "vélo", "voiture", "métro", "train", "bus"];
const WINDOWS = ["matin", "midi", "après-midi", "soir"];
const WORK_KINDS: { value: WorkStream["kind"]; label: string }[] = [
  { value: "master", label: "Master (cours)" },
  { value: "startup", label: "Startup" },
  { value: "cdd", label: "CDD" },
  { value: "autre", label: "Autre" },
];

async function api<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  return res.json();
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
        {icon && (
          <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-brand/15 text-brand">
            {icon}
          </span>
        )}
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function ReglagesPage() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [travels, setTravels] = useState<TravelTime[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [profile, setProfile] = useState<TransportProfile | null>(null);
  const [streams, setStreams] = useState<WorkStream[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  const load = useCallback(async () => {
    const [p, t, a, pr, ws, tk] = await Promise.all([
      api<Place[]>("/api/places"),
      api<TravelTime[]>("/api/travel-times"),
      api<Activity[]>("/api/activities"),
      api<TransportProfile>("/api/profile"),
      api<WorkStream[]>("/api/work-streams"),
      api<Task[]>("/api/tasks"),
    ]);
    setPlaces(p);
    setTravels(t);
    setActivities(a);
    setProfile(pr);
    setStreams(ws);
    setTasks(tk);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const nameOf = (id?: string) => places.find((p) => p.id === id)?.name || "?";

  /* ------------------------------ Lieux ------------------------------ */
  const [placeName, setPlaceName] = useState("");
  const [placeType, setPlaceType] = useState("");

  async function addPlace() {
    if (!placeName.trim()) return;
    await api("/api/places", {
      method: "POST",
      body: JSON.stringify({ name: placeName.trim(), type: placeType.trim() }),
    });
    setPlaceName("");
    setPlaceType("");
    load();
  }
  async function setHome(id: string) {
    // Un seul domicile : on retire le flag des autres.
    await Promise.all(
      places.map((p) =>
        api(`/api/places/${p.id}`, {
          method: "PUT",
          body: JSON.stringify({ isHome: p.id === id }),
        })
      )
    );
    await api("/api/profile", {
      method: "PUT",
      body: JSON.stringify({ homePlaceId: id }),
    });
    load();
  }
  async function removePlace(id: string) {
    await api(`/api/places/${id}`, { method: "DELETE" });
    load();
  }

  /* ----------------------------- Trajets ----------------------------- */
  const [tFrom, setTFrom] = useState("");
  const [tTo, setTTo] = useState("");
  const [tMin, setTMin] = useState("");
  const [tMode, setTMode] = useState(MODES[0]);

  async function addTravel() {
    if (!tFrom || !tTo || !tMin || tFrom === tTo) return;
    await api("/api/travel-times", {
      method: "POST",
      body: JSON.stringify({
        fromId: tFrom,
        toId: tTo,
        minutes: Number(tMin),
        mode: tMode,
      }),
    });
    setTMin("");
    load();
  }
  async function patchTravel(id: string, patch: Partial<TravelTime>) {
    await api(`/api/travel-times/${id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    });
    load();
  }
  async function removeTravel(id: string) {
    await api(`/api/travel-times/${id}`, { method: "DELETE" });
    load();
  }

  /* ---------------------------- Activités ---------------------------- */
  const [aName, setAName] = useState("");
  const [aCat, setACat] = useState("sport");
  const [aPlace, setAPlace] = useState("");
  const [aDur, setADur] = useState("60");
  const [aPerWeek, setAPerWeek] = useState("");
  const [aWindows, setAWindows] = useState<string[]>([]);
  const [aIsSport, setAIsSport] = useState(true);
  const [aIntensity, setAIntensity] =
    useState<"low" | "moderate" | "high">("moderate");
  const [aRest, setARest] = useState("24");

  async function addActivity() {
    if (!aName.trim()) return;
    await api("/api/activities", {
      method: "POST",
      body: JSON.stringify({
        name: aName.trim(),
        category: aCat,
        placeId: aPlace || undefined,
        durationMin: Number(aDur) || 60,
        perWeek: aPerWeek ? Number(aPerWeek) : undefined,
        preferredWindows: aWindows.length ? aWindows : undefined,
        sport: aIsSport
          ? {
              intensity: aIntensity,
              minRestHoursAfter: Number(aRest) || 24,
            }
          : undefined,
      }),
    });
    setAName("");
    setAPerWeek("");
    setAWindows([]);
    load();
  }
  async function removeActivity(id: string) {
    await api(`/api/activities/${id}`, { method: "DELETE" });
    load();
  }

  /* ----------------------------- Profil ------------------------------ */
  async function toggleMode(mode: string) {
    if (!profile) return;
    const has = profile.transportModes.includes(mode);
    const next = has
      ? profile.transportModes.filter((m) => m !== mode)
      : [...profile.transportModes, mode];
    const updated = await api<TransportProfile>("/api/profile", {
      method: "PUT",
      body: JSON.stringify({ transportModes: next }),
    });
    setProfile(updated);
  }
  async function patchProfile(patch: Partial<TransportProfile>) {
    const updated = await api<TransportProfile>("/api/profile", {
      method: "PUT",
      body: JSON.stringify(patch),
    });
    setProfile(updated);
  }

  /* --------------------------- Travail (Emilien) --------------------- */
  const [wName, setWName] = useState("");
  const [wKind, setWKind] = useState<WorkStream["kind"]>("cdd");
  const [wHours, setWHours] = useState("");
  const [wPlace, setWPlace] = useState("");

  async function addStream() {
    if (!wName.trim()) return;
    await api("/api/work-streams", {
      method: "POST",
      body: JSON.stringify({
        name: wName.trim(),
        kind: wKind,
        weeklyHoursTarget: wHours ? Number(wHours) : undefined,
        placeId: wPlace || undefined,
      }),
    });
    setWName("");
    setWHours("");
    setWPlace("");
    load();
  }
  async function removeStream(id: string) {
    await api(`/api/work-streams/${id}`, { method: "DELETE" });
    load();
  }

  /* --------------------------- TP / échéances ------------------------ */
  const [tkTitle, setTkTitle] = useState("");
  const [tkDue, setTkDue] = useState("");
  const [tkHours, setTkHours] = useState("4");
  const [tkStream, setTkStream] = useState("");

  async function addTask() {
    if (!tkTitle.trim() || !tkDue) return;
    await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: tkTitle.trim(),
        dueDate: tkDue,
        estimatedHours: Number(tkHours) || 2,
        streamId: tkStream || undefined,
      }),
    });
    setTkTitle("");
    setTkDue("");
    setTkHours("4");
    load();
  }
  async function toggleTaskDone(t: Task) {
    await api(`/api/tasks/${t.id}`, {
      method: "PUT",
      body: JSON.stringify({ done: !t.done }),
    });
    load();
  }
  async function removeTask(id: string) {
    await api(`/api/tasks/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-3 pb-16 sm:p-6">
      <header className="glass flex items-center justify-between gap-3 rounded-3xl px-4 py-3">
        <h1 className="font-display text-lg font-bold tracking-tight text-ink">
          Réglages
        </h1>
        <Link
          href="/"
          className="flex items-center gap-1.5 rounded-xl border border-line bg-white/[0.06] px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-white/10 hover:text-ink"
        >
          <CalendarIcon size={16} />
          <span>Agenda</span>
        </Link>
      </header>

      {/* Lieux */}
      <Section title="Lieux" icon={<PinIcon size={15} />}>
        <div className="mb-3 flex flex-wrap gap-2">
          <input
            value={placeName}
            onChange={(e) => setPlaceName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addPlace()}
            placeholder="Nom (ex: Piscine Orsay)"
            className="field flex-1"
          />
          <input
            value={placeType}
            onChange={(e) => setPlaceType(e.target.value)}
            placeholder="Type (sport…)"
            className="field w-36"
          />
          <button onClick={addPlace} className="btn-primary">
            Ajouter
          </button>
        </div>
        <ul className="space-y-1.5">
          {places.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-line bg-white/[0.05] px-3 py-2"
            >
              <span className="text-sm text-ink">
                {p.name}
                {p.type && (
                  <span className="ml-2 text-xs text-ink-soft">{p.type}</span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setHome(p.id)}
                  className={`rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                    p.isHome
                      ? "bg-brand/20 text-brand"
                      : "text-ink-faint hover:bg-white/10"
                  }`}
                >
                  {p.isHome ? "Domicile" : "Définir domicile"}
                </button>
                <button
                  onClick={() => removePlace(p.id)}
                  className="text-ink-faint transition hover:text-red-500"
                  aria-label="Supprimer"
                >
                  ×
                </button>
              </div>
            </li>
          ))}
          {places.length === 0 && (
            <li className="text-xs italic text-ink-faint">Aucun lieu.</li>
          )}
        </ul>
      </Section>

      {/* Trajets */}
      <Section title="Temps de trajet">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select
            value={tFrom}
            onChange={(e) => setTFrom(e.target.value)}
            className="field flex-1"
          >
            <option value="">Depuis…</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="text-ink-soft">→</span>
          <select
            value={tTo}
            onChange={(e) => setTTo(e.target.value)}
            className="field flex-1"
          >
            <option value="">Vers…</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            value={tMin}
            onChange={(e) => setTMin(e.target.value)}
            placeholder="min"
            inputMode="numeric"
            className="field w-16"
          />
          <select
            value={tMode}
            onChange={(e) => setTMode(e.target.value)}
            className="field w-28"
          >
            {MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button onClick={addTravel} className="btn-primary">
            Ajouter
          </button>
        </div>
        <ul className="space-y-1.5">
          {travels.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-line bg-white/[0.05] px-3 py-2"
            >
              <span className="text-sm text-ink">
                {nameOf(t.fromId)} ↔ {nameOf(t.toId)}
              </span>
              <div className="flex items-center gap-2">
                <input
                  defaultValue={t.minutes}
                  onBlur={(e) =>
                    Number(e.target.value) !== t.minutes &&
                    patchTravel(t.id, { minutes: Number(e.target.value) })
                  }
                  inputMode="numeric"
                  className="field w-14 py-1 text-center"
                />
                <span className="text-xs text-ink-soft">min</span>
                <select
                  value={t.mode}
                  onChange={(e) => patchTravel(t.id, { mode: e.target.value })}
                  className="field w-24 py-1"
                >
                  {MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => removeTravel(t.id)}
                  className="text-ink-faint transition hover:text-red-500"
                  aria-label="Supprimer"
                >
                  ×
                </button>
              </div>
            </li>
          ))}
          {travels.length === 0 && (
            <li className="text-xs italic text-ink-faint">Aucun trajet.</li>
          )}
        </ul>
      </Section>

      {/* Activités */}
      <Section title="Activités flexibles">
        <p className="mb-3 text-xs leading-relaxed text-ink-soft">
          Les séances que l&apos;agent peut caser dans la semaine (salle,
          piscine, voir Marine, heures de CDD…). Les métadonnées sport servent
          au coach pour la récupération.
        </p>
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <input
            value={aName}
            onChange={(e) => setAName(e.target.value)}
            placeholder="Nom"
            className="field col-span-2 sm:col-span-1"
          />
          <input
            value={aCat}
            onChange={(e) => setACat(e.target.value)}
            placeholder="Catégorie"
            className="field"
          />
          <select
            value={aPlace}
            onChange={(e) => setAPlace(e.target.value)}
            className="field"
          >
            <option value="">Lieu (optionnel)</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-ink-soft">
            Durée
            <input
              value={aDur}
              onChange={(e) => setADur(e.target.value)}
              inputMode="numeric"
              className="field w-16 py-1"
            />
            min
          </label>
          <label className="flex items-center gap-1 text-xs text-ink-soft">
            Par sem.
            <input
              value={aPerWeek}
              onChange={(e) => setAPerWeek(e.target.value)}
              inputMode="numeric"
              placeholder="—"
              className="field w-14 py-1"
            />
          </label>
        </div>

        <div className="mb-2 flex flex-wrap gap-1.5">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() =>
                setAWindows((prev) =>
                  prev.includes(w)
                    ? prev.filter((x) => x !== w)
                    : [...prev, w]
                )
              }
              className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                aWindows.includes(w)
                  ? "border-brand/50 bg-brand/15 text-brand"
                  : "border-line text-ink-soft hover:bg-white/10"
              }`}
            >
              {w}
            </button>
          ))}
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-ink-soft">
            <input
              type="checkbox"
              checked={aIsSport}
              onChange={(e) => setAIsSport(e.target.checked)}
            />
            C&apos;est du sport
          </label>
          {aIsSport && (
            <>
              <select
                value={aIntensity}
                onChange={(e) => setAIntensity(e.target.value as typeof aIntensity)}
                className="field w-32 py-1"
              >
                <option value="low">intensité faible</option>
                <option value="moderate">intensité modérée</option>
                <option value="high">intensité élevée</option>
              </select>
              <label className="flex items-center gap-1 text-xs text-ink-soft">
                Repos ≥
                <input
                  value={aRest}
                  onChange={(e) => setARest(e.target.value)}
                  inputMode="numeric"
                  className="field w-14 py-1"
                />
                h
              </label>
            </>
          )}
          <button onClick={addActivity} className="btn-primary ml-auto">
            Ajouter
          </button>
        </div>

        <ul className="space-y-1.5">
          {activities.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-line bg-white/[0.05] px-3 py-2"
            >
              <span className="text-sm text-ink">
                {a.name}
                <span className="ml-2 text-xs text-ink-soft">
                  {a.durationMin} min
                  {a.perWeek ? ` · ${a.perWeek}×/sem` : ""}
                  {a.placeId ? ` · ${nameOf(a.placeId)}` : ""}
                  {a.sport ? ` · sport ${a.sport.intensity}` : ""}
                </span>
              </span>
              <button
                onClick={() => removeActivity(a.id)}
                className="text-ink-faint transition hover:text-red-500"
                aria-label="Supprimer"
              >
                ×
              </button>
            </li>
          ))}
          {activities.length === 0 && (
            <li className="text-xs italic text-ink-faint">Aucune activité.</li>
          )}
        </ul>
      </Section>

      {/* Travail — couches (Emilien) */}
      <Section title="Travail — couches (Emilien)">
        <p className="mb-3 text-xs leading-relaxed text-ink-soft">
          Les couches de travail récurrentes qu&apos;Emilien cale chaque semaine :
          CDD Delos, startup Monumia, master… Indique l&apos;objectif d&apos;heures
          hebdo.
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={wName}
            onChange={(e) => setWName(e.target.value)}
            placeholder="Nom (ex: CDD Delos)"
            className="field flex-1"
          />
          <select
            value={wKind}
            onChange={(e) => setWKind(e.target.value as WorkStream["kind"])}
            className="field w-40"
          >
            {WORK_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-ink-soft">
            <input
              value={wHours}
              onChange={(e) => setWHours(e.target.value)}
              inputMode="numeric"
              placeholder="—"
              className="field w-14 py-1"
            />
            h/sem
          </label>
          <select
            value={wPlace}
            onChange={(e) => setWPlace(e.target.value)}
            className="field w-40"
          >
            <option value="">Lieu (optionnel)</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button onClick={addStream} className="btn-primary">
            Ajouter
          </button>
        </div>
        <ul className="space-y-1.5">
          {streams.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-line bg-white/[0.05] px-3 py-2"
            >
              <span className="text-sm text-ink">
                {s.name}
                <span className="ml-2 text-xs text-ink-soft">
                  {WORK_KINDS.find((k) => k.value === s.kind)?.label || s.kind}
                  {s.weeklyHoursTarget ? ` · ${s.weeklyHoursTarget}h/sem` : ""}
                  {s.placeId ? ` · ${nameOf(s.placeId)}` : ""}
                </span>
              </span>
              <button
                onClick={() => removeStream(s.id)}
                className="text-ink-faint transition hover:text-red-500"
                aria-label="Supprimer"
              >
                ×
              </button>
            </li>
          ))}
          {streams.length === 0 && (
            <li className="text-xs italic text-ink-faint">Aucune couche.</li>
          )}
        </ul>
      </Section>

      {/* TP / échéances */}
      <Section title="TP / échéances">
        <p className="mb-3 text-xs leading-relaxed text-ink-soft">
          Les travaux à rendre avec leur date limite. Emilien réserve assez
          d&apos;heures avant chaque échéance.
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={tkTitle}
            onChange={(e) => setTkTitle(e.target.value)}
            placeholder="Intitulé (ex: TP Optimal Transport)"
            className="field flex-1"
          />
          <select
            value={tkStream}
            onChange={(e) => setTkStream(e.target.value)}
            className="field w-40"
          >
            <option value="">Couche (optionnel)</option>
            {streams.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-ink-soft">
            Échéance
            <input
              type="date"
              value={tkDue}
              onChange={(e) => setTkDue(e.target.value)}
              className="field py-1"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-ink-soft">
            <input
              value={tkHours}
              onChange={(e) => setTkHours(e.target.value)}
              inputMode="numeric"
              className="field w-14 py-1"
            />
            h
          </label>
          <button onClick={addTask} className="btn-primary">
            Ajouter
          </button>
        </div>
        <ul className="space-y-1.5">
          {tasks.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-line bg-white/[0.05] px-3 py-2"
            >
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={Boolean(t.done)}
                  onChange={() => toggleTaskDone(t)}
                />
                <span className={t.done ? "line-through opacity-60" : ""}>
                  {t.title}
                  <span className="ml-2 text-xs text-ink-soft">
                    {t.dueDate} · {t.estimatedHours}h
                    {t.streamId
                      ? ` · ${streams.find((s) => s.id === t.streamId)?.name || "?"}`
                      : ""}
                  </span>
                </span>
              </label>
              <button
                onClick={() => removeTask(t.id)}
                className="text-ink-faint transition hover:text-red-500"
                aria-label="Supprimer"
              >
                ×
              </button>
            </li>
          ))}
          {tasks.length === 0 && (
            <li className="text-xs italic text-ink-faint">Aucun TP.</li>
          )}
        </ul>
      </Section>

      {/* Transport */}
      {profile && (
        <Section title="Transport">
          <p className="mb-2 text-xs text-ink-soft">
            Modes dont tu disposes habituellement :
          </p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {MODES.map((m) => (
              <button
                key={m}
                onClick={() => toggleMode(m)}
                className={`rounded-full border px-3 py-1.5 text-xs transition ${
                  profile.transportModes.includes(m)
                    ? "border-brand/50 bg-brand/15 text-brand"
                    : "border-line text-ink-soft hover:bg-white/10"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs text-ink-soft">
              <input
                type="checkbox"
                checked={profile.carDefault}
                onChange={(e) => patchProfile({ carDefault: e.target.checked })}
              />
              Voiture disponible par défaut
            </label>
            <label className="flex items-center gap-1.5 text-xs text-ink-soft">
              Objectif travail flexible
              <input
                defaultValue={profile.workHoursTarget ?? ""}
                onBlur={(e) =>
                  patchProfile({
                    workHoursTarget: e.target.value
                      ? Number(e.target.value)
                      : undefined,
                  })
                }
                inputMode="numeric"
                placeholder="—"
                className="field w-14 py-1"
              />
              h/sem
            </label>
          </div>
        </Section>
      )}
    </main>
  );
}

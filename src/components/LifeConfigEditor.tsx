"use client";

/**
 * Éditeur de la CONFIG DE VIE (data/life-config.json) — page réglages (v5).
 *
 * L'UI charge la config parsée (GET /api/life-config), l'édite en local par
 * sections, puis renvoie l'objet ENTIER (PUT) : le serveur revalide tout avec
 * zod (cohérence référentielle incluse) — une config invalide n'écrase jamais
 * le fichier, les erreurs remontent telles quelles dans le bandeau.
 *
 * Zéro règle métier ici : ce composant ne fait que refléter le schéma de
 * src/lib/planner/config.ts. Le prochain plan du solveur lit ce fichier.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LifeConfig, TransportMode, Weekday } from "@/lib/planner/config";

/* ------------------------------ Primitives ---------------------------- */

const MODES: TransportMode[] = ["voiture", "velo", "transports", "a-pied"];
const WEEKDAYS: Weekday[] = [
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
  "dimanche",
];

function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-snug text-ink-faint">{hint}</span>}
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  hint,
  step = 1,
  min,
  max,
  className = "",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
  step?: number;
  min?: number;
  max?: number;
  className?: string;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      <input
        type="number"
        className="field"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = e.target.valueAsNumber;
          if (!Number.isNaN(v)) onChange(v);
        }}
      />
    </Field>
  );
}

function TimeField({
  label,
  value,
  onChange,
  hint,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  className?: string;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      <input
        type="time"
        className="field"
        value={value}
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value);
        }}
      />
    </Field>
  );
}

function TextField({
  label,
  value,
  onChange,
  hint,
  mono = false,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      <input
        type="text"
        className={`field ${mono ? "font-mono text-xs" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  className = "",
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  hint?: string;
  className?: string;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      <select
        className="field"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-start justify-between gap-3 rounded-xl border border-line bg-white/[0.04] px-3 py-2.5 text-left transition hover:bg-white/[0.08]"
    >
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] leading-snug text-ink-faint">{hint}</span>}
      </span>
      <span
        aria-hidden
        className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${
          checked ? "bg-brand-gradient" : "bg-white/15"
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4" : ""
          }`}
        />
      </span>
    </button>
  );
}

/** Cases à cocher compactes pour un sous-ensemble de valeurs (modes, lieux…). */
function CheckGroup<T extends string>({
  options,
  selected,
  onChange,
}: {
  options: { value: T; label: string }[];
  selected: T[];
  onChange: (next: T[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() =>
              onChange(on ? selected.filter((v) => v !== o.value) : [...selected, o.value])
            }
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
              on
                ? "border-brand/50 bg-brand/15 text-brand"
                : "border-line bg-white/[0.04] text-ink-soft hover:bg-white/10"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Liste de tags libres (aliments bannis…) : ajout au clavier, retrait au clic. */
function TagList({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  };
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {values.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(values.filter((x) => x !== v))}
            title="Retirer"
            className="group flex items-center gap-1 rounded-lg border border-line bg-white/[0.06] px-2.5 py-1.5 text-xs text-ink transition hover:border-red-400/40 hover:bg-red-500/10"
          >
            {v}
            <span className="text-ink-faint group-hover:text-red-300">×</span>
          </button>
        ))}
        {values.length === 0 && (
          <span className="text-xs italic text-ink-faint">(aucun)</span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          className="field flex-1"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" onClick={add} className="btn-primary shrink-0">
          Ajouter
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
  defaultOpen = false,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="glass group rounded-3xl" open={defaultOpen}>
      <summary className="flex cursor-pointer select-none items-center justify-between gap-3 rounded-3xl px-5 py-4 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block font-display text-base font-bold tracking-tight text-ink">
            {title}
          </span>
          <span className="mt-0.5 block text-xs text-ink-faint">{subtitle}</span>
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="shrink-0 text-ink-faint transition-transform group-open:rotate-180"
        >
          <path d="M3 6l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="flex flex-col gap-4 px-5 pb-5">{children}</div>
    </details>
  );
}

function SubCard({ title, children, onRemove }: { title?: string; children: React.ReactNode; onRemove?: () => void }) {
  return (
    <div className="rounded-2xl border border-line bg-white/[0.03] p-3.5">
      {(title || onRemove) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink">{title}</p>
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="rounded-lg border border-line px-2 py-1 text-[11px] text-ink-faint transition hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-300"
            >
              Supprimer
            </button>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

/* ------------------------------- Éditeur ------------------------------ */

export default function LifeConfigEditor() {
  const [cfg, setCfg] = useState<LifeConfig | null>(null);
  const [snapshot, setSnapshot] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/life-config");
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      const data = (await res.json()) as LifeConfig;
      setCfg(data);
      setSnapshot(JSON.stringify(data));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "chargement impossible");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = useMemo(
    () => cfg !== null && JSON.stringify(cfg) !== snapshot,
    [cfg, snapshot]
  );

  /** Toute édition passe ici : clone profond puis mutation du brouillon. */
  const update = useCallback((fn: (draft: LifeConfig) => void) => {
    setCfg((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setSavedAt(null);
  }, []);

  async function save() {
    if (!cfg) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/life-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setCfg(data);
      setSnapshot(JSON.stringify(data));
      setSavedAt(Date.now());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <section className="glass rounded-3xl px-5 py-6">
        <p className="text-sm text-red-300">Config illisible : {loadError}</p>
        <button onClick={load} className="btn-primary mt-3">
          Réessayer
        </button>
      </section>
    );
  }
  if (!cfg) {
    return (
      <section className="glass rounded-3xl px-5 py-6 text-center text-sm text-ink-faint">
        Chargement de la config…
      </section>
    );
  }

  const placeOptions = cfg.places.map((p) => ({ value: p.id, label: p.name }));
  const clusterOptions = cfg.clusters.map((c) => ({ value: c.id, label: c.name }));
  const modeOptions = MODES.map((m) => ({ value: m, label: m }));
  const obj = cfg.solver.objective;

  return (
    <div className="flex flex-col gap-4">
      {/* Barre d'état : collante, visible pendant tout le défilement. */}
      <div className="glass-strong sticky top-2 z-20 flex items-center justify-between gap-3 rounded-2xl px-4 py-3">
        <p className="text-xs text-ink-soft">
          {saving
            ? "Enregistrement…"
            : dirty
              ? "Modifications non enregistrées"
              : savedAt
                ? "Enregistré — le prochain plan les respectera"
                : "Config de vie (data/life-config.json)"}
        </p>
        <div className="flex shrink-0 gap-2">
          {dirty && (
            <button
              type="button"
              onClick={() => {
                setCfg(JSON.parse(snapshot));
                setSaveError(null);
              }}
              className="rounded-xl border border-line px-3 py-2 text-sm text-ink-soft transition hover:bg-white/10"
            >
              Annuler
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="btn-primary disabled:opacity-40"
          >
            Enregistrer
          </button>
        </div>
      </div>

      {saveError && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs leading-relaxed text-red-300">
          <p className="mb-1 font-semibold">Config refusée (rien n&apos;a été écrasé) :</p>
          <p className="whitespace-pre-line">{saveError}</p>
        </div>
      )}

      {/* ------------------------------ Horaires --------------------------- */}
      <Section
        title="Rythme & horaires"
        subtitle="Bornes de journée, pauses, transitions, trous tolérés"
        defaultOpen
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <TimeField
            label="Début de journée"
            value={cfg.schedule.dayStart}
            onChange={(v) => update((d) => void (d.schedule.dayStart = v))}
          />
          <TimeField
            label="Fin normale"
            value={cfg.schedule.normalEnd}
            onChange={(v) => update((d) => void (d.schedule.normalEnd = v))}
            hint="Travail & sport ; sorties et dîner exemptés"
          />
          <TimeField
            label="Fin exceptionnelle"
            value={cfg.schedule.exceptionalEnd}
            onChange={(v) => update((d) => void (d.schedule.exceptionalEnd = v))}
          />
          <NumberField
            label="Exceptionnels / sem (max)"
            value={cfg.schedule.maxExceptionalPerWeek}
            min={0}
            onChange={(v) => update((d) => void (d.schedule.maxExceptionalPerWeek = v))}
          />
          <NumberField
            label="Trou max (min)"
            value={cfg.schedule.maxHoleMinutes}
            min={0}
            onChange={(v) => update((d) => void (d.schedule.maxHoleMinutes = v))}
            hint="Entre deux blocs travail/sport"
          />
          <NumberField
            label="Transition (min)"
            value={cfg.schedule.transitionMin}
            min={0}
            onChange={(v) => update((d) => void (d.schedule.transitionMin = v))}
            hint="Battement minimal entre activités"
          />
          <NumberField
            label="Déjeuner min (min)"
            value={cfg.schedule.lunchBreak.minMinutes}
            min={0}
            onChange={(v) => update((d) => void (d.schedule.lunchBreak.minMinutes = v))}
          />
          <NumberField
            label="Déjeuner idéal (min)"
            value={cfg.schedule.lunchBreak.idealMinutes}
            min={0}
            onChange={(v) => update((d) => void (d.schedule.lunchBreak.idealMinutes = v))}
          />
          <TimeField
            label="Trajet de veille dès"
            value={cfg.schedule.eveningTravelStart}
            onChange={(v) => update((d) => void (d.schedule.eveningTravelStart = v))}
            hint="Heure visée pour changer de zone la veille"
          />
          <TimeField
            label="Week-end : début"
            value={cfg.schedule.weekend.dayStart}
            onChange={(v) => update((d) => void (d.schedule.weekend.dayStart = v))}
          />
        </div>
        <Toggle
          label="Week-end léger d'abord"
          hint="Caser le maximum en semaine ; le week-end ne sert qu'au plancher inatteignable autrement"
          checked={cfg.schedule.weekend.keepLight}
          onChange={(v) => update((d) => void (d.schedule.weekend.keepLight = v))}
        />
      </Section>

      {/* ------------------------------ Travail ---------------------------- */}
      <Section title="Travail" subtitle="Delos, Monumia, imprévus, blocs minimum">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <NumberField
            label="Bloc de travail min (min)"
            value={cfg.work.minBlockMinutes}
            min={0}
            step={15}
            onChange={(v) => update((d) => void (d.work.minBlockMinutes = v))}
            hint="En dessous, mieux vaut du temps libre"
          />
          <NumberField
            label="Imprévu : heures par défaut"
            value={cfg.work.imprevus.defaultHours}
            min={0.5}
            step={0.5}
            onChange={(v) => update((d) => void (d.work.imprevus.defaultHours = v))}
            hint="Quand la demande ne précise pas"
          />
          <NumberField
            label="Imprévu : marge min (jours)"
            value={cfg.work.imprevus.marginDaysMin}
            min={0}
            onChange={(v) => update((d) => void (d.work.imprevus.marginDaysMin = v))}
            hint="Fini N jours avant l'échéance"
          />
        </div>

        <SubCard title="Delos (le CDD)">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <NumberField
              label="Demi-journées présentiel / sem"
              value={cfg.work.delos.presentielHalfDaysPerWeek}
              min={0}
              onChange={(v) => update((d) => void (d.work.delos.presentielHalfDaysPerWeek = v))}
            />
            <SelectField
              label="Lieu du présentiel"
              value={cfg.work.delos.placeId}
              options={placeOptions}
              onChange={(v) => update((d) => void (d.work.delos.placeId = v))}
            />
            <SelectField
              label="Présentiel"
              value={cfg.work.delos.presentiel}
              options={[
                { value: "obligatoire", label: "obligatoire" },
                { value: "prefere", label: "préféré" },
                { value: "indifferent", label: "indifférent" },
              ]}
              onChange={(v) => update((d) => void (d.work.delos.presentiel = v))}
            />
          </div>
          <div className="mt-3">
            <span className="field-label">Gabarits de demi-journée</span>
            <div className="flex flex-col gap-2">
              {cfg.work.delos.halfDayWindows.map((w, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="time"
                    className="field"
                    value={w.start}
                    onChange={(e) =>
                      e.target.value &&
                      update((d) => void (d.work.delos.halfDayWindows[i].start = e.target.value))
                    }
                  />
                  <span className="text-xs text-ink-faint">→</span>
                  <input
                    type="time"
                    className="field"
                    value={w.end}
                    onChange={(e) =>
                      e.target.value &&
                      update((d) => void (d.work.delos.halfDayWindows[i].end = e.target.value))
                    }
                  />
                  {cfg.work.delos.halfDayWindows.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        update((d) => void d.work.delos.halfDayWindows.splice(i, 1))
                      }
                      className="rounded-lg border border-line px-2 py-1.5 text-xs text-ink-faint hover:bg-red-500/10 hover:text-red-300"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <Toggle
              label="Regrouper en journées complètes"
              hint="2 demi-journées le même jour = un seul aller-retour Paris"
              checked={cfg.work.delos.groupHalfDays}
              onChange={(v) => update((d) => void (d.work.delos.groupHalfDays = v))}
            />
            <Toggle
              label="Week-end en dernier recours"
              hint="Tolère Delos le week-end quand la semaine ne suffit pas (le quota, lui, ne bouge jamais)"
              checked={cfg.work.delos.weekendOk}
              onChange={(v) => update((d) => void (d.work.delos.weekendOk = v))}
            />
          </div>
          <div className="mt-3">
            <Toggle
              label="Heures à distance"
              hint="Le reste du contrat, horaires libres hors Paris"
              checked={!!cfg.work.delos.remote}
              onChange={(v) =>
                update((d) => {
                  d.work.delos.remote = v
                    ? { hoursPerWeek: 4, placeId: d.work.monumia.preferredPlaceIds[0] || d.places[0].id, blockHours: [4, 2] }
                    : undefined;
                })
              }
            />
            {cfg.work.delos.remote && (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <NumberField
                  label="Heures / sem"
                  value={cfg.work.delos.remote.hoursPerWeek}
                  min={0}
                  step={0.5}
                  onChange={(v) => update((d) => void (d.work.delos.remote!.hoursPerWeek = v))}
                />
                <SelectField
                  label="Lieu par défaut"
                  value={cfg.work.delos.remote.placeId}
                  options={placeOptions}
                  onChange={(v) => update((d) => void (d.work.delos.remote!.placeId = v))}
                />
                <TextField
                  label="Découpages (h)"
                  value={cfg.work.delos.remote.blockHours.join(", ")}
                  onChange={(v) =>
                    update((d) => {
                      const nums = v
                        .split(",")
                        .map((x) => Number(x.trim()))
                        .filter((x) => Number.isFinite(x) && x > 0);
                      if (nums.length > 0) d.work.delos.remote!.blockHours = nums;
                    })
                  }
                  hint="Du plus simple au plus fractionné, ex : 4, 2"
                />
              </div>
            )}
          </div>
        </SubCard>

        <SubCard title="Monumia (la startup)">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <NumberField
              label="Plancher (h/sem)"
              value={cfg.work.monumia.minHoursPerWeek}
              min={0}
              onChange={(v) => update((d) => void (d.work.monumia.minHoursPerWeek = v))}
            />
            <NumberField
              label="Plafond (h/sem)"
              value={cfg.work.monumia.maxHoursPerWeek}
              min={0}
              onChange={(v) => update((d) => void (d.work.monumia.maxHoursPerWeek = v))}
            />
            <NumberField
              label="Max / jour (h)"
              value={cfg.work.monumia.maxHoursPerDay}
              min={0}
              onChange={(v) => update((d) => void (d.work.monumia.maxHoursPerDay = v))}
            />
            <NumberField
              label="Max / jour week-end (h)"
              value={cfg.work.monumia.weekendMaxHoursPerDay}
              min={0}
              onChange={(v) => update((d) => void (d.work.monumia.weekendMaxHoursPerDay = v))}
              hint="0 = week-end interdit"
            />
            <NumberField
              label="Confort semaine (h/jour)"
              value={cfg.work.monumia.weekdayComfortHoursPerDay}
              min={0}
              onChange={(v) => update((d) => void (d.work.monumia.weekdayComfortHoursPerDay = v))}
              hint="Au-delà, on déborde sur le week-end plutôt que densifier"
            />
          </div>
          <div className="mt-3">
            <Toggle
              label="Maximiser au-delà du plancher"
              hint="Le solveur vise le plafond ; l'objectif « jours off » fait contrepoids"
              checked={cfg.work.monumia.maximize}
              onChange={(v) => update((d) => void (d.work.monumia.maximize = v))}
            />
          </div>
          <div className="mt-3">
            <span className="field-label">Lieux préférés (dans l&apos;ordre)</span>
            <CheckGroup
              options={placeOptions}
              selected={cfg.work.monumia.preferredPlaceIds}
              onChange={(v) => update((d) => void (d.work.monumia.preferredPlaceIds = v))}
            />
          </div>
        </SubCard>

        <SubCard title="Cours (info indicative)">
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Heures / sem (~)"
              value={cfg.work.cours.hoursPerWeek}
              min={0}
              onChange={(v) => update((d) => void (d.work.cours.hoursPerWeek = v))}
              hint="Les cours réels sont les événements fixes de l'agenda"
            />
            <SelectField
              label="Lieu des cours"
              value={cfg.work.cours.placeId}
              options={placeOptions}
              onChange={(v) => update((d) => void (d.work.cours.placeId = v))}
            />
          </div>
        </SubCard>
      </Section>

      {/* ------------------------------- Sport ----------------------------- */}
      <Section title="Sport" subtitle="Quotas, rotation par activité, créneaux imposés">
        <div className="grid grid-cols-3 gap-3">
          <NumberField
            label="Séances min / sem"
            value={cfg.sport.sessionsPerWeekMin}
            min={0}
            onChange={(v) => update((d) => void (d.sport.sessionsPerWeekMin = v))}
          />
          <NumberField
            label="Séances max / sem"
            value={cfg.sport.sessionsPerWeekMax}
            min={0}
            onChange={(v) => update((d) => void (d.sport.sessionsPerWeekMax = v))}
          />
          <NumberField
            label="Douche après (min)"
            value={cfg.sport.bufferAfterMin}
            min={0}
            onChange={(v) => update((d) => void (d.sport.bufferAfterMin = v))}
          />
        </div>
        {cfg.sport.activities.map((a, i) => (
          <SubCard
            key={a.id}
            title={`${a.name} — ${a.id}`}
            onRemove={() => update((d) => void d.sport.activities.splice(i, 1))}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <TextField
                label="Nom"
                value={a.name}
                onChange={(v) => update((d) => void (d.sport.activities[i].name = v))}
              />
              <SelectField
                label="Statut"
                value={a.status}
                options={[
                  { value: "voulu", label: "voulu (rotation)" },
                  { value: "impose", label: "imposé (toujours)" },
                  { value: "optionnel", label: "optionnel (sur demande)" },
                ]}
                onChange={(v) => update((d) => void (d.sport.activities[i].status = v))}
              />
              <NumberField
                label="Séances / sem"
                value={a.perWeek}
                min={0}
                max={7}
                onChange={(v) => update((d) => void (d.sport.activities[i].perWeek = v))}
                hint="La rotation du solveur"
              />
              <NumberField
                label="Durée (min)"
                value={a.durationMin}
                min={10}
                step={5}
                onChange={(v) => update((d) => void (d.sport.activities[i].durationMin = v))}
              />
              <SelectField
                label="Intensité"
                value={a.intensity}
                options={[
                  { value: "low", label: "faible" },
                  { value: "moderate", label: "modérée" },
                  { value: "high", label: "élevée" },
                ]}
                onChange={(v) => update((d) => void (d.sport.activities[i].intensity = v))}
              />
              <NumberField
                label="Récup min (h)"
                value={a.minRestHours}
                min={0}
                onChange={(v) => update((d) => void (d.sport.activities[i].minRestHours = v))}
              />
            </div>
            <div className="mt-3">
              <span className="field-label">Lieux possibles (vide = n&apos;importe où)</span>
              <CheckGroup
                options={placeOptions}
                selected={a.placeIds}
                onChange={(v) => update((d) => void (d.sport.activities[i].placeIds = v))}
              />
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <Toggle
                label="Possible le matin"
                checked={a.morningOk}
                onChange={(v) => update((d) => void (d.sport.activities[i].morningOk = v))}
              />
              <Toggle
                label="Heures d'ouverture"
                checked={!!a.openingHours}
                onChange={(v) =>
                  update(
                    (d) =>
                      void (d.sport.activities[i].openingHours = v
                        ? { open: "08:00", close: "22:00" }
                        : null)
                  )
                }
              />
              {a.openingHours && (
                <div className="grid grid-cols-2 gap-3">
                  <TimeField
                    label="Ouvre"
                    value={a.openingHours.open}
                    onChange={(v) => update((d) => void (d.sport.activities[i].openingHours!.open = v))}
                  />
                  <TimeField
                    label="Ferme"
                    value={a.openingHours.close}
                    onChange={(v) => update((d) => void (d.sport.activities[i].openingHours!.close = v))}
                  />
                </div>
              )}
              <Toggle
                label="Créneau imposé"
                hint="Jour + heure figés (ex : natation avec la fac)"
                checked={!!a.fixedSlot}
                onChange={(v) =>
                  update(
                    (d) =>
                      void (d.sport.activities[i].fixedSlot = v
                        ? { weekday: "jeudi", start: "18:00", end: "19:00" }
                        : null)
                  )
                }
              />
              {a.fixedSlot && (
                <div className="grid grid-cols-3 gap-3">
                  <SelectField
                    label="Jour"
                    value={a.fixedSlot.weekday}
                    options={WEEKDAYS.map((w) => ({ value: w, label: w }))}
                    onChange={(v) => update((d) => void (d.sport.activities[i].fixedSlot!.weekday = v))}
                  />
                  <TimeField
                    label="Début"
                    value={a.fixedSlot.start}
                    onChange={(v) => update((d) => void (d.sport.activities[i].fixedSlot!.start = v))}
                  />
                  <TimeField
                    label="Fin"
                    value={a.fixedSlot.end}
                    onChange={(v) => update((d) => void (d.sport.activities[i].fixedSlot!.end = v))}
                  />
                </div>
              )}
            </div>
          </SubCard>
        ))}
        <button
          type="button"
          onClick={() =>
            update((d) => {
              let n = d.sport.activities.length + 1;
              while (d.sport.activities.some((a) => a.id === `activite-${n}`)) n++;
              d.sport.activities.push({
                id: `activite-${n}`,
                name: "Nouvelle activité",
                status: "optionnel",
                perWeek: 1,
                placeIds: [],
                durationMin: 60,
                intensity: "moderate",
                minRestHours: 24,
                morningOk: false,
                fixedSlot: null,
                openingHours: null,
              });
            })
          }
          className="rounded-xl border border-dashed border-line px-3 py-2.5 text-sm text-ink-soft transition hover:bg-white/[0.06] hover:text-ink"
        >
          + Ajouter une activité
        </button>
      </Section>

      {/* ------------------------------ Sorties ---------------------------- */}
      <Section title="Sorties" subtitle="Marine, les amis — rien n'est jamais inventé">
        <SubCard title={cfg.sorties.copine.name}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <TextField
              label="Prénom"
              value={cfg.sorties.copine.name}
              onChange={(v) => update((d) => void (d.sorties.copine.name = v))}
            />
            <NumberField
              label="Objectif / sem"
              value={cfg.sorties.copine.perWeekMin}
              min={0}
              onChange={(v) => update((d) => void (d.sorties.copine.perWeekMin = v))}
              hint="Un rappel (warning), pas une fabrication"
            />
            <SelectField
              label="Zone habituelle"
              value={cfg.sorties.copine.usualCluster}
              options={clusterOptions}
              onChange={(v) => update((d) => void (d.sorties.copine.usualCluster = v))}
            />
          </div>
        </SubCard>
        <SubCard title="Amis">
          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label="Zone habituelle"
              value={cfg.sorties.amis.usualCluster}
              options={clusterOptions}
              onChange={(v) => update((d) => void (d.sorties.amis.usualCluster = v))}
            />
            <div className="self-end">
              <Toggle
                label="Sur demande uniquement"
                checked={cfg.sorties.amis.onRequestOnly}
                onChange={(v) => update((d) => void (d.sorties.amis.onRequestOnly = v))}
              />
            </div>
          </div>
        </SubCard>
      </Section>

      {/* ------------------------------ Cuisine ---------------------------- */}
      <Section title="Cuisine" subtitle="Budget, appétit, aliments bannis (chat Simone)">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SelectField
            label="Budget"
            value={cfg.cuisine.budget}
            options={[
              { value: "etudiant", label: "étudiant" },
              { value: "moyen", label: "moyen" },
              { value: "large", label: "large" },
            ]}
            onChange={(v) => update((d) => void (d.cuisine.budget = v))}
          />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Toggle
            label="Grosses portions"
            checked={cfg.cuisine.bigAppetite}
            onChange={(v) => update((d) => void (d.cuisine.bigAppetite = v))}
          />
          <Toggle
            label="Adapter au sport"
            checked={cfg.cuisine.adaptToSport}
            onChange={(v) => update((d) => void (d.cuisine.adaptToSport = v))}
          />
          <Toggle
            label="CROUS si cours le matin"
            checked={cfg.cuisine.lunchAtCrousIfMorningClass}
            onChange={(v) => update((d) => void (d.cuisine.lunchAtCrousIfMorningClass = v))}
          />
          <Toggle
            label="Aucun repas chez les parents"
            checked={cfg.cuisine.noMealsAtParents}
            onChange={(v) => update((d) => void (d.cuisine.noMealsAtParents = v))}
          />
        </div>
        <div>
          <span className="field-label">Aliments bannis</span>
          <TagList
            values={cfg.cuisine.dislikedFoods}
            onChange={(v) => update((d) => void (d.cuisine.dislikedFoods = v))}
            placeholder="ex : courgettes"
          />
        </div>
      </Section>

      {/* --------------------------- Lieux & zones -------------------------- */}
      <Section title="Lieux & zones" subtitle="Clusters, lieux, trajets, modes de transport">
        <div>
          <span className="field-label">Modes de transport possédés</span>
          <CheckGroup
            options={modeOptions}
            selected={cfg.ownedModes}
            onChange={(v) => update((d) => void (d.ownedModes = v))}
          />
        </div>
        {cfg.clusters.map((c, i) => (
          <SubCard key={c.id} title={`Zone ${c.name} — ${c.id}`}>
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Nom"
                value={c.name}
                onChange={(v) => update((d) => void (d.clusters[i].name = v))}
              />
              <NumberField
                label="Trajet interne (min)"
                value={c.intraTravelMin}
                min={0}
                onChange={(v) => update((d) => void (d.clusters[i].intraTravelMin = v))}
                hint="Forfait entre deux lieux de la zone"
              />
            </div>
          </SubCard>
        ))}
        {cfg.interClusterTravel.map((t, i) => (
          <SubCard key={i} title={`Trajet ${t.between[0]} ↔ ${t.between[1]}`}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {MODES.map((m) => (
                <Field key={m} label={`${m} (min)`}>
                  <input
                    type="number"
                    className="field"
                    min={0}
                    placeholder="—"
                    value={t.minutesByMode[m] ?? ""}
                    onChange={(e) =>
                      update((d) => {
                        const v = e.target.valueAsNumber;
                        if (e.target.value === "" || Number.isNaN(v)) {
                          delete d.interClusterTravel[i].minutesByMode[m];
                        } else {
                          d.interClusterTravel[i].minutesByMode[m] = v;
                        }
                      })
                    }
                  />
                </Field>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-ink-faint">Vide = mode impossible pour ce trajet.</p>
          </SubCard>
        ))}
        {cfg.places.map((p, i) => (
          <SubCard
            key={p.id}
            title={`${p.name} — ${p.id}`}
            onRemove={() => update((d) => void d.places.splice(i, 1))}
          >
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Nom"
                value={p.name}
                onChange={(v) => update((d) => void (d.places[i].name = v))}
              />
              <SelectField
                label="Zone"
                value={p.cluster}
                options={clusterOptions}
                onChange={(v) => update((d) => void (d.places[i].cluster = v))}
              />
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <Toggle
                label="On peut y dormir"
                checked={p.sleepable}
                onChange={(v) => update((d) => void (d.places[i].sleepable = v))}
              />
              <div>
                <span className="field-label">Modes interdits pour s&apos;y rendre</span>
                <CheckGroup
                  options={modeOptions}
                  selected={p.forbiddenModes}
                  onChange={(v) => update((d) => void (d.places[i].forbiddenModes = v))}
                />
              </div>
            </div>
          </SubCard>
        ))}
        <button
          type="button"
          onClick={() =>
            update((d) => {
              let n = d.places.length + 1;
              while (d.places.some((p) => p.id === `lieu-${n}`)) n++;
              d.places.push({
                id: `lieu-${n}`,
                name: "Nouveau lieu",
                cluster: d.clusters[0].id,
                forbiddenModes: [],
                sleepable: false,
              });
            })
          }
          className="rounded-xl border border-dashed border-line px-3 py-2.5 text-sm text-ink-soft transition hover:bg-white/[0.06] hover:text-ink"
        >
          + Ajouter un lieu
        </button>
      </Section>

      {/* ------------------------------ Solveur ---------------------------- */}
      <Section
        title="Solveur & objectif"
        subtitle="Candidats et poids du score — ce qui départage les plans légaux"
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <NumberField
            label="Plans candidats (K)"
            value={cfg.solver.candidates}
            min={1}
            max={50}
            onChange={(v) => update((d) => void (d.solver.candidates = v))}
            hint="Générés puis départagés par le score"
          />
        </div>
        <p className="text-[11px] leading-relaxed text-ink-faint">
          Chaque terme = poids × mesure ; un poids à 0 éteint le terme. Bonus en
          vert, pénalités en rouge. La trace de debug montre le score des K
          candidats à chaque planification.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <NumberField
            label="− Violation warn"
            value={obj.warn}
            min={0}
            onChange={(v) => update((d) => void (d.solver.objective.warn = v))}
            hint="Par avertissement restant"
          />
          <NumberField
            label="− Trous (par h)"
            value={obj.trouParHeure}
            min={0}
            onChange={(v) => update((d) => void (d.solver.objective.trouParHeure = v))}
            hint="Temps mort entre deux blocs"
          />
          <NumberField
            label="+ Monumia (par h)"
            value={obj.monumiaParHeure}
            min={0}
            onChange={(v) => update((d) => void (d.solver.objective.monumiaParHeure = v))}
            hint="Au-dessus du plancher hebdo"
          />
          <NumberField
            label="+ Sport étalé"
            value={obj.sportEtalement}
            min={0}
            onChange={(v) => update((d) => void (d.solver.objective.sportEtalement = v))}
            hint="Par jour d'écart min entre séances"
          />
          <NumberField
            label="+ Jour off"
            value={obj.jourOff}
            min={0}
            onChange={(v) => update((d) => void (d.solver.objective.jourOff = v))}
            hint="Par jour sans travail ni sport"
          />
          <NumberField
            label="− Travail week-end (par h)"
            value={obj.weekendTravailParHeure}
            min={0}
            onChange={(v) => update((d) => void (d.solver.objective.weekendTravailParHeure = v))}
          />
          <NumberField
            label="− Fin tardive (par h)"
            value={obj.finTardiveParHeure}
            min={0}
            onChange={(v) => update((d) => void (d.solver.objective.finTardiveParHeure = v))}
          />
          <TimeField
            label="Tardif après"
            value={obj.finTardiveApres}
            onChange={(v) => update((d) => void (d.solver.objective.finTardiveApres = v))}
          />
          <NumberField
            label="− Jour Paris en trop"
            value={obj.delosJourParisSupplementaire}
            min={0}
            onChange={(v) => update((d) => void (d.solver.objective.delosJourParisSupplementaire = v))}
            hint="Delos présentiel éclaté au lieu de groupé"
          />
        </div>
      </Section>
    </div>
  );
}

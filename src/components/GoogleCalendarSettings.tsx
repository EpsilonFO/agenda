"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Réglages Google Calendar : connexion de comptes (OAuth), choix du
 * calendrier, sens de synchro, niveau de détail des copies, catégorie des
 * imports, état du dernier passage. Chaque changement est enregistré tout
 * de suite (PATCH) et déclenche un passage différé.
 */

type PublicAccount = {
  id: string;
  email: string;
  name?: string;
  calendarId: string;
  calendarSummary?: string;
  push: boolean;
  pull: boolean;
  detail: "full" | "busy";
  busyTitle: string;
  category: string;
  excludeCategories: string[];
  status: "ok" | "reauth" | "error";
  lastSyncAt?: string;
  lastError?: string;
  lastStats?: Record<string, unknown>;
};

type Overview = {
  configured: boolean;
  redirectUri: string;
  timeZone: string;
  window: { past: number; future: number };
  accounts: PublicAccount[];
};

type CalendarOption = { id: string; summary: string; primary: boolean };

type AccountResult = {
  email: string;
  ok: boolean;
  error?: string;
  stats: Record<string, number | string[]>;
};

function fmtDate(iso?: string): string {
  if (!iso) return "jamais";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} à ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtStats(s?: Record<string, unknown>): string {
  if (!s) return "";
  const n = (k: string) => Number(s[k] || 0);
  const up = `${n("pushedCreated")} créé(s), ${n("pushedUpdated")} modifié(s), ${n("pushedDeleted")} supprimé(s)`;
  const down = `${n("pulledCreated")} importé(s), ${n("pulledUpdated")} mis à jour, ${n("pulledDeleted")} retiré(s)`;
  const failed = n("failed") ? ` · ${n("failed")} opération(s) en échec` : "";
  return `Vers Google : ${up}. Depuis Google : ${down}.${failed}`;
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
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

function StatusPill({ account }: { account: PublicAccount }) {
  if (account.status === "reauth") {
    return (
      <span className="rounded-lg bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-300">
        Reconnexion requise
      </span>
    );
  }
  if (account.status === "error") {
    return (
      <span className="rounded-lg bg-red-500/15 px-2 py-1 text-[11px] font-semibold text-red-300">
        Erreur
      </span>
    );
  }
  return (
    <span className="rounded-lg bg-brand/15 px-2 py-1 text-[11px] font-semibold text-brand">
      Connecté
    </span>
  );
}

export default function GoogleCalendarSettings() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [calendars, setCalendars] = useState<Record<string, CalendarOption[] | "loading" | "error">>({});
  const [drafts, setDrafts] = useState<Record<string, Partial<PublicAccount>>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/google/accounts");
      if (!res.ok) throw new Error("chargement impossible");
      setData(await res.json());
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Retour du consentement Google (?google=ok|error).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    const g = q.get("google");
    if (!g) return;
    if (g === "ok") {
      setMsg({
        kind: "ok",
        text: `Compte ${q.get("email") || "Google"} connecté. Première synchro en cours…`,
      });
      // Laisse le premier passage se faire puis rafraîchit l'état.
      setTimeout(load, 4000);
    } else {
      setMsg({ kind: "error", text: `Connexion Google échouée : ${q.get("reason") || "erreur inconnue"}` });
    }
    q.delete("google");
    q.delete("email");
    q.delete("reason");
    const clean = `${window.location.pathname}${q.toString() ? `?${q}` : ""}`;
    window.history.replaceState(null, "", clean);
  }, [load]);

  function connect(email?: string) {
    const url = email ? `/api/google/auth?email=${encodeURIComponent(email)}` : "/api/google/auth";
    window.location.href = url;
  }

  async function patch(id: string, body: Partial<PublicAccount>) {
    const res = await fetch(`/api/google/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setMsg({ kind: "error", text: d.error || "Enregistrement impossible." });
      return;
    }
    const updated: PublicAccount = await res.json();
    setData((d) =>
      d ? { ...d, accounts: d.accounts.map((a) => (a.id === id ? updated : a)) } : d
    );
  }

  async function loadCalendars(id: string) {
    if (calendars[id] && calendars[id] !== "error") return;
    setCalendars((c) => ({ ...c, [id]: "loading" }));
    try {
      const res = await fetch(`/api/google/accounts/${id}/calendars`);
      if (!res.ok) throw new Error();
      const list: CalendarOption[] = await res.json();
      setCalendars((c) => ({ ...c, [id]: list }));
    } catch {
      setCalendars((c) => ({ ...c, [id]: "error" }));
    }
  }

  async function syncNow(accountId?: string) {
    setSyncing(true);
    setMsg({ kind: "info", text: "Synchronisation…" });
    try {
      const res = await fetch("/api/google/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accountId ? { accountId } : {}),
      });
      const report = await res.json();
      if (report.skipped) {
        setMsg({ kind: "info", text: `Rien à faire : ${report.skipped}` });
      } else {
        const results: AccountResult[] = report.accounts || [];
        const failed = results.filter((r) => !r.ok);
        setMsg(
          failed.length
            ? {
                kind: "error",
                text: `Échec pour ${failed.map((r) => `${r.email} (${r.error})`).join(", ")}`,
              }
            : { kind: "ok", text: `Synchronisé (${results.length} compte(s)).` }
        );
      }
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSyncing(false);
      load();
    }
  }

  async function disconnect(account: PublicAccount) {
    if (!window.confirm(`Déconnecter ${account.email} ?\n\nLes événements importés depuis ce compte seront retirés de l'agenda.`)) return;
    const purge = window.confirm(
      "Supprimer aussi les copies envoyées dans ce calendrier Google ?\n\nOK = les blocs « Agenda » disparaissent de Google Calendar.\nAnnuler = ils restent (utile si tu reconnectes bientôt)."
    );
    setMsg({ kind: "info", text: "Déconnexion…" });
    const res = await fetch(`/api/google/accounts/${account.id}${purge ? "?purge=1" : ""}`, {
      method: "DELETE",
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg({ kind: "error", text: d.error || "Déconnexion impossible." });
      return;
    }
    setMsg({
      kind: "ok",
      text: `${account.email} déconnecté${purge ? ` · ${d.purged ?? 0} copie(s) retirée(s) de Google` : ""}${
        d.removedLocal ? ` · ${d.removedLocal} événement(s) importé(s) retiré(s)` : ""
      }${d.purgeError ? ` · purge incomplète : ${d.purgeError}` : ""}`,
    });
    load();
  }

  function draft(id: string, key: keyof PublicAccount, value: string) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [key]: value } }));
  }

  function commitDraft(id: string, key: "busyTitle" | "category" | "excludeCategories", account: PublicAccount) {
    const v = drafts[id]?.[key];
    if (v === undefined) return;
    const current = key === "excludeCategories" ? account.excludeCategories.join(", ") : account[key];
    if (String(v) === String(current)) return;
    patch(id, { [key]: v } as Partial<PublicAccount>);
  }

  if (loading) {
    return <p className="text-xs text-ink-faint">Chargement…</p>;
  }

  if (!data) {
    return <p className="text-xs text-red-300">{msg?.text || "État Google indisponible."}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-ink-soft">
        Tes événements sont copiés dans le calendrier Google choisi (les gens
        voient quand tu es pris, tu peux les inviter depuis l&apos;agenda), et les
        événements de ce calendrier — invitations reçues comprises — apparaissent
        ici. Fenêtre synchronisée : {data.window.past} jours en arrière,{" "}
        {data.window.future} jours en avant. Fuseau : {data.timeZone}.
      </p>

      {!data.configured && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-200">
          Google n&apos;est pas configuré : renseigne <code>GOOGLE_CLIENT_ID</code> et{" "}
          <code>GOOGLE_CLIENT_SECRET</code> dans <code>.env.local</code> puis relance le
          serveur. La marche à suivre côté Google Cloud est dans <code>GOOGLE.md</code>.
          <br />
          URI de redirection à déclarer : <code className="break-all">{data.redirectUri}</code>
        </div>
      )}

      {msg && (
        <p
          className={`rounded-xl border px-3 py-2 text-xs ${
            msg.kind === "error"
              ? "border-red-500/30 bg-red-500/10 text-red-300"
              : msg.kind === "ok"
                ? "border-brand/30 bg-brand/10 text-brand"
                : "border-line bg-white/[0.04] text-ink-soft"
          }`}
        >
          {msg.text}
        </p>
      )}

      {data.accounts.map((a) => {
        const cals = calendars[a.id];
        const d = drafts[a.id] || {};
        return (
          <div key={a.id} className="rounded-2xl border border-line bg-white/[0.03] p-3.5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{a.email}</p>
                <p className="text-[11px] text-ink-faint">
                  Dernière synchro : {fmtDate(a.lastSyncAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill account={a} />
                {a.status === "reauth" && (
                  <button onClick={() => connect(a.email)} className="btn-primary !px-3 !py-1.5 text-xs">
                    Reconnecter
                  </button>
                )}
              </div>
            </div>

            {a.lastError && (
              <p className="mb-3 rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-300">
                {a.lastError}
              </p>
            )}

            <div className="flex flex-col gap-2">
              <label className="block">
                <span className="field-label">Calendrier synchronisé</span>
                <select
                  className="field"
                  value={a.calendarId}
                  onFocus={() => loadCalendars(a.id)}
                  onMouseDown={() => loadCalendars(a.id)}
                  onChange={(e) => {
                    const list = Array.isArray(cals) ? cals : [];
                    const found = list.find((c) => c.id === e.target.value);
                    patch(a.id, { calendarId: e.target.value, calendarSummary: found?.summary });
                  }}
                >
                  {!Array.isArray(cals) && (
                    <option value={a.calendarId}>
                      {a.calendarSummary || (a.calendarId === "primary" ? "Calendrier principal" : a.calendarId)}
                      {cals === "loading" ? " (chargement…)" : cals === "error" ? " (liste indisponible)" : ""}
                    </option>
                  )}
                  {Array.isArray(cals) &&
                    cals.map((c) => (
                      <option key={c.id} value={c.primary ? "primary" : c.id}>
                        {c.summary}
                        {c.primary ? " (principal)" : ""}
                      </option>
                    ))}
                  {Array.isArray(cals) &&
                    !cals.some((c) => (c.primary ? "primary" : c.id) === a.calendarId) && (
                      <option value={a.calendarId}>{a.calendarSummary || a.calendarId}</option>
                    )}
                </select>
              </label>

              <Toggle
                label="Agenda → Google"
                hint="Copie tes événements dans ce calendrier (les gens te voient occupé, tes invitations partent d'ici)."
                checked={a.push}
                onChange={(v) => patch(a.id, { push: v })}
              />
              <Toggle
                label="Google → Agenda"
                hint="Importe les événements de ce calendrier (invitations reçues, réunions) dans l'agenda."
                checked={a.pull}
                onChange={(v) => patch(a.id, { pull: v })}
              />

              {a.push && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="block">
                    <span className="field-label">Contenu des copies</span>
                    <select
                      className="field"
                      value={a.detail}
                      onChange={(e) => patch(a.id, { detail: e.target.value as "full" | "busy" })}
                    >
                      <option value="full">Titre, lieu et notes réels</option>
                      <option value="busy">Bloc « occupé » privé (sans détails)</option>
                    </select>
                  </label>
                  {a.detail === "busy" && (
                    <label className="block">
                      <span className="field-label">Titre des blocs</span>
                      <input
                        className="field"
                        value={d.busyTitle ?? a.busyTitle}
                        onChange={(e) => draft(a.id, "busyTitle", e.target.value)}
                        onBlur={() => commitDraft(a.id, "busyTitle", a)}
                      />
                    </label>
                  )}
                  <label className="block">
                    <span className="field-label">Catégories jamais copiées</span>
                    <input
                      className="field"
                      placeholder="ex : repas, trajet"
                      value={
                        typeof d.excludeCategories === "string"
                          ? (d.excludeCategories as unknown as string)
                          : a.excludeCategories.join(", ")
                      }
                      onChange={(e) =>
                        draft(a.id, "excludeCategories", e.target.value)
                      }
                      onBlur={() => commitDraft(a.id, "excludeCategories", a)}
                    />
                  </label>
                </div>
              )}

              {a.pull && (
                <label className="block sm:max-w-[50%]">
                  <span className="field-label">Catégorie des événements importés</span>
                  <input
                    className="field"
                    value={d.category ?? a.category}
                    onChange={(e) => draft(a.id, "category", e.target.value)}
                    onBlur={() => commitDraft(a.id, "category", a)}
                  />
                </label>
              )}
            </div>

            {a.lastStats && (
              <p className="mt-3 text-[11px] leading-snug text-ink-faint">{fmtStats(a.lastStats)}</p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => syncNow(a.id)}
                disabled={syncing || a.status === "reauth"}
                className="rounded-xl border border-line px-3 py-2 text-sm text-ink-soft transition hover:bg-white/10 disabled:opacity-50"
              >
                Synchroniser ce compte
              </button>
              <button
                onClick={() => disconnect(a)}
                disabled={syncing}
                className="ml-auto rounded-xl px-3 py-2 text-sm font-semibold text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
              >
                Déconnecter
              </button>
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => connect()}
          disabled={!data.configured}
          className="btn-primary disabled:opacity-50"
        >
          {data.accounts.length ? "Connecter un autre compte Google" : "Connecter un compte Google"}
        </button>
        {data.accounts.length > 0 && (
          <button
            onClick={() => syncNow()}
            disabled={syncing}
            className="rounded-xl border border-line px-3 py-2 text-sm text-ink-soft transition hover:bg-white/10 disabled:opacity-50"
          >
            {syncing ? "Synchronisation…" : "Synchroniser maintenant"}
          </button>
        )}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";

type Status = { registered: boolean; authenticated: boolean };

export default function LoginPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [enroll, setEnroll] = useState(false); // mode « nouvel appareil »
  const [code, setCode] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/status");
      const data = (await res.json()) as Status;
      setStatus(data);
      if (data.authenticated) window.location.href = "/";
      if (!data.registered) setEnroll(true); // aucune passkey → forcément enrôlement
    } catch {
      setStatus({ registered: false, authenticated: false });
      setEnroll(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function unlock() {
    setBusy(true);
    setError("");
    try {
      const optRes = await fetch("/api/auth/login/options", { method: "POST" });
      if (!optRes.ok) throw new Error("Impossible de démarrer le déverrouillage.");
      const options = await optRes.json();
      const assertion = await startAuthentication({ optionsJSON: options });
      const verRes = await fetch("/api/auth/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: assertion }),
      });
      if (!verRes.ok) throw new Error("Déverrouillage refusé.");
      window.location.href = "/";
    } catch (err) {
      setError(errMessage(err));
      setBusy(false);
    }
  }

  async function enrollDevice() {
    setBusy(true);
    setError("");
    try {
      const optRes = await fetch("/api/auth/register/options", {
        method: "POST",
        headers: { "x-enroll-code": code.trim() },
      });
      if (optRes.status === 403) throw new Error("Code d'enrôlement invalide.");
      if (!optRes.ok) throw new Error("Impossible de démarrer l'enrôlement.");
      const options = await optRes.json();
      const attestation = await startRegistration({ optionsJSON: options });
      const verRes = await fetch("/api/auth/register/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-enroll-code": code.trim(),
        },
        body: JSON.stringify({
          response: attestation,
          label: navigator.userAgent.slice(0, 40),
        }),
      });
      if (!verRes.ok) {
        const d = await verRes.json().catch(() => ({}));
        throw new Error(d.error || "Enregistrement refusé.");
      }
      window.location.href = "/";
    } catch (err) {
      setError(errMessage(err));
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="glass w-full max-w-sm rounded-3xl p-6">
        <h1 className="font-display text-xl font-bold tracking-tight text-ink">
          Agenda
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {enroll
            ? status?.registered
              ? "Enrôler ce nouvel appareil"
              : "Première configuration de l'accès"
            : "Déverrouille pour accéder à ton agenda"}
        </p>

        <div className="mt-6 space-y-3">
          {enroll ? (
            <>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && code.trim() && enrollDevice()}
                placeholder="Code d'enrôlement"
                autoComplete="one-time-code"
                className="field w-full"
              />
              <button
                onClick={enrollDevice}
                disabled={busy || !code.trim()}
                className="btn-primary w-full disabled:opacity-50"
              >
                {busy ? "…" : "Créer la clé d'accès (Face ID)"}
              </button>
              {status?.registered && (
                <button
                  onClick={() => {
                    setEnroll(false);
                    setError("");
                  }}
                  className="w-full text-xs text-ink-faint transition hover:text-ink-soft"
                >
                  ← Revenir au déverrouillage
                </button>
              )}
            </>
          ) : (
            <>
              <button
                onClick={unlock}
                disabled={busy}
                className="btn-primary w-full disabled:opacity-50"
              >
                {busy ? "…" : "Déverrouiller avec Face ID"}
              </button>
              <button
                onClick={() => {
                  setEnroll(true);
                  setError("");
                }}
                className="w-full text-xs text-ink-faint transition hover:text-ink-soft"
              >
                Nouvel appareil ? Enrôler avec le code
              </button>
            </>
          )}

          {error && (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

function errMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // L'utilisateur a annulé la fenêtre Face ID / passkey.
  if (/NotAllowed|aborted|cancel/i.test(msg)) {
    return "Opération annulée.";
  }
  return msg || "Une erreur est survenue.";
}

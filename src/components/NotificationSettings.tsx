"use client";

import { useCallback, useEffect, useState } from "react";

/** Convertit la clé VAPID publique (base64url) en Uint8Array pour PushManager. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type State = "idle" | "working" | "on" | "denied" | "unsupported";

export default function NotificationSettings() {
  const [state, setState] = useState<State>("idle");
  const [msg, setMsg] = useState<string>("");
  // Détecte iOS non-installé : le push y est impossible hors écran d'accueil.
  const [needsInstall, setNeedsInstall] = useState(false);

  const refresh = useCallback(async () => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setState("unsupported");
      return;
    }
    // iOS : le push exige que la PWA soit lancée depuis l'écran d'accueil.
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone =
      (window.navigator as unknown as { standalone?: boolean }).standalone ===
        true ||
      window.matchMedia("(display-mode: standalone)").matches;
    if (isIOS && !standalone) setNeedsInstall(true);

    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    setState(sub ? "on" : "idle");
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function enable() {
    setState("working");
    setMsg("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("denied");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) {
        setMsg("Clé VAPID publique manquante (NEXT_PUBLIC_VAPID_PUBLIC_KEY).");
        setState("idle");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub, ua: navigator.userAgent }),
      });
      if (!res.ok) throw new Error("échec enregistrement serveur");
      setState("on");
      setMsg("Notifications activées sur cet appareil.");
    } catch (err) {
      console.error(err);
      setMsg("Impossible d'activer les notifications.");
      setState("idle");
    }
  }

  async function disable() {
    setState("working");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("idle");
      setMsg("Notifications désactivées sur cet appareil.");
    } catch (err) {
      console.error(err);
      setState("on");
    }
  }

  async function test() {
    setMsg("Envoi du test…");
    const res = await fetch("/api/push/test", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setMsg(
      data.sent ? `Test envoyé à ${data.sent} appareil(s).` : "Aucun envoi."
    );
  }

  return (
    <div>
      {needsInstall && (
        <p className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-300">
          Sur iPhone, les notifications ne marchent que si l&apos;app est
          installée : touche <strong>Partager</strong> → <strong>Sur
          l&apos;écran d&apos;accueil</strong>, puis rouvre l&apos;app depuis son
          icône et reviens ici.
        </p>
      )}

      {state === "unsupported" ? (
        <p className="text-xs italic text-ink-faint">
          Ce navigateur ne supporte pas les notifications push.
        </p>
      ) : state === "denied" ? (
        <p className="text-xs text-ink-soft">
          Notifications bloquées dans les réglages du navigateur/système.
          Réautorise-les puis recharge la page.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {state === "on" ? (
            <>
              <span className="rounded-lg bg-brand/20 px-2.5 py-1.5 text-xs font-medium text-brand">
                Activées sur cet appareil
              </span>
              <button onClick={test} className="btn-primary">
                Tester
              </button>
              <button
                onClick={disable}
                className="rounded-xl border border-line px-3 py-2 text-sm text-ink-soft transition hover:bg-white/10"
              >
                Désactiver
              </button>
            </>
          ) : (
            <button
              onClick={enable}
              disabled={state === "working"}
              className="btn-primary disabled:opacity-50"
            >
              {state === "working" ? "…" : "Activer les notifications"}
            </button>
          )}
        </div>
      )}

      {msg && <p className="mt-2 text-xs text-ink-soft">{msg}</p>}
    </div>
  );
}

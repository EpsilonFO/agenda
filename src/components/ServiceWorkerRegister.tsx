"use client";

import { useEffect } from "react";

/**
 * Enregistre le service worker (public/sw.js) au chargement.
 * Nécessaire pour la PWA installable et pour les notifications push.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("Échec enregistrement du service worker :", err);
      });
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);
  return null;
}

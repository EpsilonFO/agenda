"use client";

import { useEffect } from "react";

/**
 * Enregistre le service worker (public/sw.js) au chargement.
 * Nécessaire pour la PWA installable et pour les notifications push.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Un nouveau SW a pris le contrôle (nouvelle version déployée) :
    // on recharge pour servir le nouveau code immédiatement.
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });

    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          // Revérifie une nouvelle version au retour au premier plan
          // (utile en PWA installée, où l'app reste ouverte longtemps).
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") reg.update();
          });
        })
        .catch((err) => {
          console.warn("Échec enregistrement du service worker :", err);
        });
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);
  return null;
}

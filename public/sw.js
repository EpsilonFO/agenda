/* Service worker — Agenda IA.
 * Rôle : recevoir les notifications push (web push) et gérer le clic dessus.
 * Un SW enregistré est OBLIGATOIRE pour que le push fonctionne sur iOS.
 */

// Activation immédiate (pas d'attente que les anciens onglets se ferment).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim())
);

// Réception d'une notification push.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Agenda", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Agenda IA";
  const options = {
    body: data.body || "",
    icon: "/icons/calendar.png",
    badge: "/icons/calendar.png",
    tag: data.tag, // regroupe/écrase les notifs d'un même event
    data: { url: data.url || "/" },
    // Vibration légère (ignoré sur iOS mais utile sur Android).
    vibrate: [80, 40, 80],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Clic sur une notification : ouvre/refocus l'app.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ("focus" in client) {
            client.navigate(target);
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      })
  );
});

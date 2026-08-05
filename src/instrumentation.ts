/**
 * Démarre le rappel des événements directement dans le process du serveur,
 * sans dépendre d'un crontab externe sur le VPS (fragile : hors git, invisible
 * si jamais installé ou perdu après une réinstall). `register()` est appelé
 * une seule fois au démarrage du serveur Next (pas pendant le build).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { runReminders } = await import("./lib/reminders");

  const CHECK_EVERY_MS = 60_000;

  const tick = async () => {
    try {
      await runReminders(new Date());
    } catch (err) {
      console.error("[reminders] échec du passage périodique:", err);
    }
  };

  tick();
  setInterval(tick, CHECK_EVERY_MS);
}

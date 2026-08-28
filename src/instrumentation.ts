/**
 * Démarre le rappel des événements directement dans le process du serveur,
 * sans dépendre d'un crontab externe sur le VPS (fragile : hors git, invisible
 * si jamais installé ou perdu après une réinstall). `register()` est appelé
 * une seule fois au démarrage du serveur Next (pas pendant le build).
 *
 * L'import de `./lib/reminders` (qui tire `web-push`, dépendant de modules
 * Node natifs http/https/net) doit rester imbriqué dans ce `if` : Next
 * compile ce fichier à la fois pour le runtime Node et le runtime Edge, et
 * webpack n'élimine la branche morte côté Edge que si l'import est bien à
 * l'intérieur du bloc — pas après un early return.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Le provider LLM actif, annoncé au démarrage : une clé absente ou un
    // LLM_PROVIDER mal orthographié se voit ici, pas au premier message.
    const { describeLlmConfig } = await import("./lib/llm");
    console.log(`[llm] ${describeLlmConfig()}`);

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
}

import { promises as fs } from "fs";
import path from "path";
import { listEvents } from "./store";
import { parseIso, formatTime } from "./dates";
import { sendToAll } from "./push";

/**
 * Rappels d'événements : à chaque passage du cron, on notifie les événements
 * qui commencent bientôt (dans la fenêtre de « préavis ») et qu'on n'a pas
 * encore signalés. L'état « déjà notifié » est persisté dans data/notified.json.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const NOTIFIED_FILE = path.join(DATA_DIR, "notified.json");

/** Préavis en minutes (rappel X min avant le début). */
const LEAD_MIN = Number(process.env.REMINDER_LEAD_MIN || 30);

type NotifiedMap = Record<string, string>; // clé -> ISO d'envoi

async function readNotified(): Promise<NotifiedMap> {
  try {
    const raw = await fs.readFile(NOTIFIED_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeNotified(map: NotifiedMap): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(NOTIFIED_FILE, JSON.stringify(map, null, 2), "utf8");
}

export type ReminderRun = {
  checked: number;
  due: number;
  pushed: number;
};

/**
 * Passe en revue les événements et notifie ceux qui débutent dans les
 * prochaines LEAD_MIN minutes. Idempotent : chaque événement n'est notifié
 * qu'une fois. `now` est injecté (pas de Date dans les modules partagés).
 */
export async function runReminders(now: Date): Promise<ReminderRun> {
  const events = await listEvents();
  const notified = await readNotified();
  const nowMs = now.getTime();

  let due = 0;
  let pushed = 0;

  for (const ev of events) {
    const startMs = parseIso(ev.start).getTime();
    if (Number.isNaN(startMs)) continue;
    const minsUntil = (startMs - nowMs) / 60000;
    // Préavis : utilise reminderMin de l'événement, sinon le défaut global.
    const leadMin = typeof ev.reminderMin === "number" ? ev.reminderMin : LEAD_MIN;
    // Fenêtre : l'événement commence entre maintenant et leadMin minutes.
    if (minsUntil < 0 || minsUntil > leadMin) continue;
    // Clé stable par (événement + heure de début) — survit à un déplacement.
    const key = `${ev.id}@${ev.start}`;
    if (notified[key]) continue;

    due++;
    const rounded = Math.max(1, Math.round(minsUntil));
    const parts = [`Dans ${rounded} min · ${formatTime(parseIso(ev.start))}`];
    if (ev.location) parts.push(ev.location);
    const sent = await sendToAll({
      title: ev.title,
      body: parts.join(" · "),
      url: "/",
      tag: ev.id, // écrase un éventuel rappel précédent du même event
    });
    if (sent > 0) pushed++;
    notified[key] = now.toISOString();
  }

  // Purge des marqueurs de plus de 24 h pour garder le fichier léger.
  const cutoff = nowMs - 24 * 60 * 60 * 1000;
  for (const [key, iso] of Object.entries(notified)) {
    if (new Date(iso).getTime() < cutoff) delete notified[key];
  }
  await writeNotified(notified);

  return { checked: events.length, due, pushed };
}

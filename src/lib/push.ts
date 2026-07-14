import { promises as fs } from "fs";
import path from "path";
import webpush, { type PushSubscription } from "web-push";

/**
 * Notifications push (Web Push / VAPID).
 * Les abonnements des appareils sont stockés dans data/push-subscriptions.json,
 * dans le même esprit fichier-JSON que le reste du stockage (store.ts).
 */

const DATA_DIR = path.join(process.cwd(), "data");
const SUBS_FILE = path.join(DATA_DIR, "push-subscriptions.json");

export type StoredSubscription = PushSubscription & {
  /** Métadonnée facultative pour reconnaître l'appareil. */
  ua?: string;
  addedAt?: string;
};

let vapidConfigured = false;

/** Configure web-push avec les clés VAPID (idempotent). Renvoie false si non configuré. */
export function ensureVapid(): boolean {
  if (vapidConfigured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

async function readSubs(): Promise<StoredSubscription[]> {
  try {
    const raw = await fs.readFile(SUBS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeSubs(subs: StoredSubscription[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(SUBS_FILE, JSON.stringify(subs, null, 2), "utf8");
}

/** Ajoute (ou remplace) un abonnement, dédupliqué par endpoint. */
export async function addSubscription(
  sub: StoredSubscription,
  addedAt: string
): Promise<void> {
  const subs = await readSubs();
  const next = subs.filter((s) => s.endpoint !== sub.endpoint);
  next.push({ ...sub, addedAt });
  await writeSubs(next);
}

/** Retire un abonnement par endpoint. */
export async function removeSubscription(endpoint: string): Promise<void> {
  const subs = await readSubs();
  await writeSubs(subs.filter((s) => s.endpoint !== endpoint));
}

export async function listSubscriptions(): Promise<StoredSubscription[]> {
  return readSubs();
}

export type PushPayload = {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
};

/**
 * Envoie une notification à tous les appareils abonnés.
 * Nettoie automatiquement les abonnements expirés (404/410).
 * Renvoie le nombre d'envois réussis.
 */
export async function sendToAll(payload: PushPayload): Promise<number> {
  if (!ensureVapid()) {
    console.warn("[push] VAPID non configuré — envoi ignoré.");
    return 0;
  }
  const subs = await readSubs();
  if (subs.length === 0) return 0;

  const data = JSON.stringify(payload);
  const stale: string[] = [];
  let ok = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, data);
        ok++;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          stale.push(sub.endpoint); // abonnement mort
        } else {
          console.warn("[push] échec envoi :", status ?? err);
        }
      }
    })
  );

  if (stale.length) {
    const remaining = subs.filter((s) => !stale.includes(s.endpoint));
    await writeSubs(remaining);
  }
  return ok;
}

import { colorFor, listEvents, mutateEvents, newEventId } from "../store";
import type { EventItem } from "../types";
import { getAccount, listAccounts, updateAccount, type GoogleAccount } from "./accounts";
import { googleConfigured, syncWindow } from "./config";
import * as gcal from "./client";
import { GoogleAuthError } from "./oauth";
import { planAccountSync, type LocalOp, type SyncPlan } from "./plan";
import { syncTimeZone } from "./time";
import { listTombstones, removeTombstones, type Tombstone } from "./tombstones";
import { emptyStats, type AccountSyncResult, type SyncReport } from "./types";

/**
 * Orchestration d'un passage de synchro (tous les comptes ou un seul) :
 * lecture Google + locale → plan (plan.ts, pur) → application côté Google
 * puis côté local (une seule écriture d'events.json par compte) → statut.
 *
 * Un seul passage à la fois (mutex) ; un appel pendant un passage en cours
 * en programme un autre juste après.
 */

let running: Promise<SyncReport> | null = null;
let rerun = false;
let lastReport: SyncReport | null = null;

export function lastSyncReport(): SyncReport | null {
  return lastReport;
}

export async function runGoogleSync(opts: { accountId?: string; now?: Date } = {}): Promise<SyncReport> {
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    try {
      let report = await runOnce(opts);
      while (rerun) {
        rerun = false;
        report = await runOnce(opts);
      }
      return report;
    } finally {
      running = null;
    }
  })();
  return running;
}

async function runOnce(opts: { accountId?: string; now?: Date }): Promise<SyncReport> {
  const now = opts.now || new Date();
  const ranAt = now.toISOString();
  if (!googleConfigured()) {
    return (lastReport = { ranAt, skipped: "Google non configuré (GOOGLE_CLIENT_ID / SECRET)", accounts: [] });
  }
  let accounts = await listAccounts();
  if (opts.accountId) accounts = accounts.filter((a) => a.id === opts.accountId);
  if (accounts.length === 0) {
    return (lastReport = { ranAt, skipped: "aucun compte Google connecté", accounts: [] });
  }

  const results: AccountSyncResult[] = [];
  for (const account of accounts) {
    if (account.status === "reauth") {
      results.push({
        accountId: account.id,
        email: account.email,
        ok: false,
        error: "reconnexion requise",
        stats: emptyStats(),
        durationMs: 0,
      });
      continue;
    }
    results.push(await syncAccount(account, now));
  }
  lastReport = { ranAt, accounts: results };
  return lastReport;
}

async function syncAccount(account: GoogleAccount, now: Date): Promise<AccountSyncResult> {
  const t0 = Date.now();
  const stats = emptyStats();
  const nowIso = now.toISOString();
  const tz = syncTimeZone();
  const window = syncWindow(now);

  try {
    // Lecture Google d'abord : si elle échoue, on ne touche à RIEN
    // (une liste partielle serait lue comme des suppressions).
    const remote = await gcal.listEventsInWindow(account, account.calendarId, window.start, window.end);
    // Le rafraîchissement du jeton a pu écrire le compte : on repart de la version disque.
    account = (await getAccount(account.id)) || account;
    const [local, tombstones] = await Promise.all([listEvents(), listTombstones()]);

    const plan = planAccountSync({ account, local, remote, tombstones, window, tz, now });
    stats.warnings.push(...plan.warnings);

    const { extraLocal, doneTombstones } = await applyRemote(account, plan, stats, nowIso);
    await applyLocal([...plan.local, ...extraLocal], stats, nowIso);
    await removeTombstones(doneTombstones);

    await updateAccount(account.id, {
      status: "ok",
      lastSyncAt: nowIso,
      lastError: undefined,
      lastStats: { ...stats, warnings: stats.warnings.slice(0, 20) },
    });
    return { accountId: account.id, email: account.email, ok: true, stats, durationMs: Date.now() - t0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[google-sync] ${account.email} : ${message}`);
    await updateAccount(account.id, {
      status: err instanceof GoogleAuthError ? "reauth" : "error",
      lastError: message,
    });
    return {
      accountId: account.id,
      email: account.email,
      ok: false,
      error: message,
      stats,
      durationMs: Date.now() - t0,
    };
  }
}

/** Joue les opérations Google une par une ; une erreur isolée n'arrête pas le passage. */
async function applyRemote(
  account: GoogleAccount,
  plan: SyncPlan,
  stats: ReturnType<typeof emptyStats>,
  nowIso: string
): Promise<{ extraLocal: LocalOp[]; doneTombstones: Tombstone[] }> {
  const extraLocal: LocalOp[] = [];
  const doneTombstones: Tombstone[] = [];
  const cal = account.calendarId;

  for (const op of plan.remote) {
    try {
      switch (op.kind) {
        case "insert": {
          const created = await gcal.insertEvent(account, cal, op.body, op.sendUpdates);
          stats.pushedCreated++;
          if (op.invite) {
            const localId = op.localId;
            extraLocal.push({
              kind: "update",
              id: localId,
              patch: {
                invite: {
                  accountId: account.id,
                  eventId: created.id,
                  ...(created.htmlLink ? { htmlLink: created.htmlLink } : {}),
                  sentAt: nowIso,
                },
              },
            });
          }
          break;
        }
        case "patch": {
          await gcal.patchEvent(account, cal, op.googleId, op.body, op.sendUpdates);
          stats.pushedUpdated++;
          break;
        }
        case "patch-origin": {
          const updated = await gcal.patchEvent(account, cal, op.googleId, op.body, op.sendUpdates);
          stats.pushedUpdated++;
          extraLocal.push({
            kind: "modify",
            id: op.localId,
            // Marqueurs refermés avec la version Google fraîchement écrite.
            fn: (cur) => ({
              google: {
                ...(cur.google || { accountId: account.id, calendarId: cal, eventId: op.googleId }),
                ...(updated.etag ? { etag: updated.etag } : {}),
                ...(updated.updated ? { updated: updated.updated } : {}),
                syncedAt: nowIso,
              },
              updatedAt: nowIso,
            }),
          });
          break;
        }
        case "delete": {
          await gcal.deleteEvent(account, cal, op.googleId, op.sendUpdates);
          if (op.tombstone) {
            doneTombstones.push(op.tombstone);
            stats.tombstones++;
          } else {
            stats.pushedDeleted++;
          }
          break;
        }
      }
    } catch (err) {
      if (err instanceof GoogleAuthError) throw err;
      stats.failed++;
      const message = err instanceof Error ? err.message : String(err);
      stats.warnings.push(`${op.kind} ${"googleId" in op ? op.googleId : op.localId} : ${message}`);
      console.error(`[google-sync] ${account.email} ${op.kind} échoué : ${message}`);
    }
  }
  return { extraLocal, doneTombstones };
}

/** Applique le lot local en UNE écriture d'events.json. */
async function applyLocal(ops: LocalOp[], stats: ReturnType<typeof emptyStats>, nowIso: string): Promise<void> {
  if (ops.length === 0) return;
  await mutateEvents((events) => {
    const index = new Map(events.map((e, i) => [e.id, i] as const));
    const toDelete = new Set<string>();
    for (const op of ops) {
      switch (op.kind) {
        case "create": {
          const ev: EventItem = {
            ...op.event,
            color: op.event.color || colorFor(op.event.category),
            id: newEventId(),
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          // Un importé écrit par la synchro est « synchronisé » à sa création.
          if (ev.google) ev.google = { ...ev.google, syncedAt: nowIso };
          index.set(ev.id, events.push(ev) - 1);
          stats.pulledCreated++;
          break;
        }
        case "update":
        case "modify": {
          const i = index.get(op.id);
          if (i === undefined) break;
          const cur = events[i];
          const patch = op.kind === "update" ? op.patch : op.fn(cur);
          events[i] = { ...cur, ...patch, updatedAt: patch.updatedAt || nowIso };
          if (cur.source === "google" && patch.title !== undefined) stats.pulledUpdated++;
          break;
        }
        case "delete": {
          toDelete.add(op.id);
          stats.pulledDeleted++;
          break;
        }
      }
    }
    return toDelete.size ? events.filter((e) => !toDelete.has(e.id)) : events;
  });
}

/* --------------------- Déclenchement différé (après une écriture) --------------------- */

let timer: NodeJS.Timeout | null = null;

/**
 * Programme un passage dans ~2 s (regroupe une rafale de modifications, ex.
 * l'écriture d'un plan de semaine). Ne lève jamais : les échecs sont loggés
 * et visibles dans les réglages.
 */
export function requestSyncSoon(delayMs = 2000): void {
  if (!googleConfigured()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    runGoogleSync().catch((err) => console.error("[google-sync] passage différé échoué :", err));
  }, delayMs);
}

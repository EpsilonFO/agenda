import type { EventItem } from "../types";
import type { GoogleAccount } from "./accounts";
import type { Tombstone } from "./tombstones";
import type { GoogleEvent, GoogleEventBody } from "./types";
import {
  diffOriginPatch,
  hasGuests,
  hashBody,
  importGoogleEvent,
  importSkipReason,
  inviteFeedback,
  mergeAttendeeStatuses,
  ownHash,
  ownLocalId,
  projectLocalEvent,
} from "./mapping";
import { localIsoToInstant, overlapsWindow } from "./time";

/**
 * Planification PURE d'un passage de synchro pour un compte : compare l'état
 * local (events.json) à l'état Google (fenêtre glissante) et produit la
 * liste des opérations à jouer des deux côtés. Aucun réseau, aucune écriture :
 * c'est sync.ts qui applique, et les tests vérifient ici toute la logique.
 *
 * Principes :
 *  - PUSH (agenda → Google) : chaque événement local de la fenêtre a une copie
 *    marquée `agendaId` dans le calendrier. Copie manquante → insert ; hash
 *    différent → patch ; copie sans événement local → delete (orphelin : plan
 *    réécrit, catégorie exclue, événement supprimé…). Aucun état côté serveur.
 *  - PULL (Google → agenda) : les événements Google SANS marqueur sont
 *    importés (source "google"). Disparu / annulé / refusé → supprimé
 *    localement. Modifié des deux côtés → Google gagne (c'est le calendrier
 *    partagé qui fait foi), avec un avertissement.
 *  - Un événement importé d'un compte est aussi poussé (miroir) vers les
 *    AUTRES comptes connectés — jamais vers le sien.
 */

export type NewLocalEvent = Omit<EventItem, "id" | "createdAt" | "updatedAt">;

export type RemoteOp =
  | { kind: "insert"; localId: string; body: GoogleEventBody; sendUpdates: boolean; invite: boolean }
  | {
      kind: "patch";
      googleId: string;
      localId: string;
      body: GoogleEventBody;
      sendUpdates: boolean;
      invite: boolean;
    }
  | {
      /** Modification locale d'un événement IMPORTÉ, renvoyée à son origine. */
      kind: "patch-origin";
      googleId: string;
      localId: string;
      body: Partial<GoogleEventBody>;
      sendUpdates: boolean;
    }
  | {
      kind: "delete";
      googleId: string;
      sendUpdates: boolean;
      reason: "orphan" | "duplicate" | "push-off" | "tombstone";
      tombstone?: Tombstone;
    };

export type LocalOp =
  | { kind: "create"; event: NewLocalEvent }
  | { kind: "update"; id: string; patch: Partial<Omit<EventItem, "id" | "createdAt">> }
  | {
      /** Mise à jour calculée à partir de l'état courant (fusion de sous-objets). */
      kind: "modify";
      id: string;
      fn: (current: EventItem) => Partial<Omit<EventItem, "id" | "createdAt">>;
    }
  | { kind: "delete"; id: string; reason: string };

export type SyncPlan = {
  remote: RemoteOp[];
  local: LocalOp[];
  warnings: string[];
};

export type PlanInput = {
  account: GoogleAccount;
  local: EventItem[];
  remote: GoogleEvent[];
  tombstones: Tombstone[];
  window: { start: Date; end: Date };
  tz: string;
  now: Date;
};

function inWindow(ev: Pick<EventItem, "start" | "end">, input: PlanInput): boolean {
  const s = localIsoToInstant(ev.start, input.tz);
  const e = localIsoToInstant(ev.end, input.tz);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return false;
  return overlapsWindow(s, e, input.window.start, input.window.end);
}

export function planAccountSync(input: PlanInput): SyncPlan {
  const { account, local, remote, tombstones, tz, now } = input;
  const nowIso = now.toISOString();
  const remoteOps: RemoteOp[] = [];
  const localOps: LocalOp[] = [];
  const warnings: string[] = [];
  const excluded = new Set(account.excludeCategories.map((c) => c.toLowerCase()));

  /* 1. Partition des événements Google : nos copies vs étrangers. */
  const own = new Map<string, GoogleEvent[]>();
  const foreign: GoogleEvent[] = [];
  for (const g of remote) {
    const lid = ownLocalId(g);
    if (lid) {
      const arr = own.get(lid) || [];
      arr.push(g);
      own.set(lid, arr);
    } else {
      foreign.push(g);
    }
  }

  /* 2. Ensemble désiré côté Google (push). */
  const desired = new Map<string, { ev: EventItem; body: GoogleEventBody; invite: boolean }>();
  if (account.push) {
    for (const ev of local) {
      if (!ev.start || !ev.end || !inWindow(ev, input)) continue;
      // Jamais renvoyer à un compte ce qui en vient (écho).
      if (ev.source === "google" && ev.google?.accountId === account.id) continue;
      if (ev.category && excluded.has(ev.category.toLowerCase())) continue;
      const invite = Boolean(ev.attendees?.length && ev.invite?.accountId === account.id);
      const body = projectLocalEvent(ev, {
        detail: account.detail,
        busyTitle: account.busyTitle,
        withAttendees: invite,
        tz,
      });
      desired.set(ev.id, { ev, body, invite });
    }
  }

  /* 3. Réconciliation de nos copies. */
  const handled = new Set<string>();
  for (const [lid, copies] of own) {
    const live = copies.filter((c) => c.status !== "cancelled");
    for (const dup of live.slice(1)) {
      remoteOps.push({ kind: "delete", googleId: dup.id, sendUpdates: hasGuests(dup), reason: "duplicate" });
    }
    const copy = live[0];
    const want = desired.get(lid);
    if (!want) {
      if (copy) {
        remoteOps.push({
          kind: "delete",
          googleId: copy.id,
          sendUpdates: hasGuests(copy),
          reason: account.push ? "orphan" : "push-off",
        });
      }
      continue;
    }
    handled.add(lid);
    if (!copy) {
      // Copie annulée côté Google (ou jamais créée) : on la recrée.
      remoteOps.push({ kind: "insert", localId: lid, body: want.body, sendUpdates: want.invite, invite: want.invite });
      continue;
    }
    if (ownHash(copy) !== hashBody(want.body)) {
      remoteOps.push({
        kind: "patch",
        googleId: copy.id,
        localId: lid,
        body: mergeAttendeeStatuses(want.body, copy),
        sendUpdates: want.invite || hasGuests(copy),
        invite: want.invite,
      });
    }
    if (want.invite) {
      const fb = inviteFeedback(want.ev, copy, nowIso);
      if (fb) localOps.push({ kind: "update", id: lid, patch: fb });
    }
  }
  for (const [lid, want] of desired) {
    if (handled.has(lid)) continue;
    remoteOps.push({ kind: "insert", localId: lid, body: want.body, sendUpdates: want.invite, invite: want.invite });
  }

  /* 4. Import (pull). */
  const localByGid = new Map<string, EventItem>();
  for (const e of local) {
    if (e.source === "google" && e.google?.accountId === account.id) localByGid.set(e.google.eventId, e);
  }
  // Supprimés localement mais pas encore côté Google : ne surtout pas les ré-importer.
  const tombstoned = new Set(tombstones.filter((t) => t.accountId === account.id).map((t) => t.eventId));
  if (account.pull) {
    const seen = new Set<string>();
    for (const g of foreign) {
      seen.add(g.id);
      const existing = localByGid.get(g.id);
      const skip = tombstoned.has(g.id) ? "tombstone" : importSkipReason(g);
      if (skip) {
        if (existing) localOps.push({ kind: "delete", id: existing.id, reason: skip });
        continue;
      }
      const imported = importGoogleEvent(g, account, tz, nowIso);
      if (!existing) {
        localOps.push({
          kind: "create",
          event: { ...imported, category: account.category, source: "google" },
        });
        continue;
      }
      const remoteChanged = (g.updated || "") > (existing.google?.updated || "");
      const localChanged = existing.updatedAt > (existing.google?.syncedAt || "");

      if (localChanged && !remoteChanged) {
        const patch = diffOriginPatch(existing, imported, tz);
        if (Object.keys(patch).length > 0) {
          remoteOps.push({
            kind: "patch-origin",
            googleId: g.id,
            localId: existing.id,
            body: patch,
            sendUpdates: hasGuests(g),
          });
        } else {
          // Rien de substantiel n'a changé (ex. couleur) : on referme le marqueur.
          localOps.push({
            kind: "update",
            id: existing.id,
            patch: { google: { ...existing.google!, syncedAt: nowIso }, updatedAt: nowIso },
          });
        }
        continue;
      }
      if (remoteChanged) {
        if (localChanged) {
          warnings.push(`« ${existing.title} » modifié des deux côtés : version Google conservée`);
        }
        localOps.push({ kind: "update", id: existing.id, patch: { ...imported, updatedAt: nowIso } });
      }
    }
    // Importés qui ont disparu de Google (dans la fenêtre) → supprimés localement.
    for (const [gid, e] of localByGid) {
      if (seen.has(gid) || !inWindow(e, input)) continue;
      localOps.push({ kind: "delete", id: e.id, reason: "absent de Google" });
    }
  }

  /* 5. Pierres tombales : suppressions locales d'importés à rejouer côté Google. */
  for (const t of tombstones) {
    if (t.accountId !== account.id) continue;
    remoteOps.push({ kind: "delete", googleId: t.eventId, sendUpdates: true, reason: "tombstone", tombstone: t });
  }

  return { remote: remoteOps, local: localOps, warnings };
}

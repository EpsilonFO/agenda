import { NextRequest, NextResponse } from "next/server";
import {
  getAccount,
  removeAccount,
  sanitizeSettingsPatch,
  toPublic,
  updateAccount,
} from "@/lib/google/accounts";
import * as gcal from "@/lib/google/client";
import { syncWindowDays } from "@/lib/google/config";
import { hasGuests, ownLocalId } from "@/lib/google/mapping";
import { revokeToken } from "@/lib/google/oauth";
import { requestSyncSoon } from "@/lib/google/sync";
import { clearTombstonesForAccount } from "@/lib/google/tombstones";
import { mutateEvents } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Réglages d'un compte (calendrier, sens de synchro, niveau de détail…). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }
  const patch = sanitizeSettingsPatch(body);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "aucun réglage reconnu" }, { status: 400 });
  }
  const account = await updateAccount(params.id, patch);
  if (!account) return NextResponse.json({ error: "compte introuvable" }, { status: 404 });
  requestSyncSoon();
  return NextResponse.json(toPublic(account));
}

/**
 * Déconnexion. `?purge=1` supprime d'abord (meilleur effort) nos copies dans
 * le calendrier Google ; dans tous les cas : révocation du jeton, suppression
 * du compte, des événements importés depuis ce compte et de ses pierres
 * tombales.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const account = await getAccount(params.id);
  if (!account) return NextResponse.json({ error: "compte introuvable" }, { status: 404 });

  let purged = 0;
  let purgeError: string | undefined;
  if (req.nextUrl.searchParams.get("purge") === "1") {
    try {
      const now = Date.now();
      const { past } = syncWindowDays();
      const copies = (
        await gcal.listEventsInWindow(
          account,
          account.calendarId,
          new Date(now - past * 86_400_000),
          new Date(now + 400 * 86_400_000)
        )
      ).filter((g) => ownLocalId(g) && g.status !== "cancelled");
      for (const g of copies) {
        try {
          await gcal.deleteEvent(account, account.calendarId, g.id, hasGuests(g));
          purged++;
        } catch (err) {
          purgeError = err instanceof Error ? err.message : String(err);
        }
      }
    } catch (err) {
      purgeError = err instanceof Error ? err.message : String(err);
    }
  }

  await revokeToken(account.refreshToken);
  await removeAccount(account.id);
  await clearTombstonesForAccount(account.id);
  let removedLocal = 0;
  await mutateEvents((events) => {
    const kept = events.filter((e) => !(e.source === "google" && e.google?.accountId === account.id));
    removedLocal = events.length - kept.length;
    return kept;
  });

  return NextResponse.json({ ok: true, purged, purgeError, removedLocal });
}

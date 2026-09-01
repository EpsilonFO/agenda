import { NextResponse } from "next/server";
import { getAccount } from "@/lib/google/accounts";
import * as gcal from "@/lib/google/client";
import { getEvent, mutateEvents } from "@/lib/store";
import type { AttendeeResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const RESPONSES: AttendeeResponse[] = ["accepted", "declined", "tentative"];

/**
 * Répondre à une invitation reçue (événement importé) : { eventId, response }.
 * Écrit la réponse côté Google (l'organisateur est notifié) puis reflète
 * localement. Un refus retire l'événement de l'agenda — comme Google Agenda,
 * qui masque les événements refusés (la synchro ferait pareil au passage
 * suivant : les refusés ne sont pas importés).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { eventId?: string; response?: string };
  const response = body.response as AttendeeResponse;
  if (!body.eventId || !RESPONSES.includes(response)) {
    return NextResponse.json({ error: "eventId et response (accepted|declined|tentative) requis" }, { status: 400 });
  }
  const ev = await getEvent(body.eventId);
  if (!ev) return NextResponse.json({ error: "événement introuvable" }, { status: 404 });
  if (ev.source !== "google" || !ev.google) {
    return NextResponse.json({ error: "cet événement ne vient pas d'une invitation Google" }, { status: 400 });
  }
  const account = await getAccount(ev.google.accountId);
  if (!account) return NextResponse.json({ error: "compte Google déconnecté" }, { status: 409 });

  try {
    const remote = await gcal.getEvent(account, ev.google.calendarId, ev.google.eventId);
    if (!remote) return NextResponse.json({ error: "événement disparu côté Google" }, { status: 410 });
    const attendees = (remote.attendees || []).map((a) =>
      a.self ? { ...a, responseStatus: response } : a
    );
    if (!attendees.some((a) => a.self)) {
      return NextResponse.json({ error: "tu n'es pas invité à cet événement" }, { status: 400 });
    }
    const updated = await gcal.patchEvent(account, ev.google.calendarId, ev.google.eventId, { attendees }, true);

    const nowIso = new Date().toISOString();
    await mutateEvents((events) => {
      if (response === "declined") return events.filter((e) => e.id !== ev.id);
      const i = events.findIndex((e) => e.id === ev.id);
      if (i === -1) return events;
      const cur = events[i];
      events[i] = {
        ...cur,
        attendees: (cur.attendees || []).map((a) => (a.self ? { ...a, responseStatus: response } : a)),
        google: {
          ...cur.google!,
          myResponse: response,
          ...(updated.etag ? { etag: updated.etag } : {}),
          ...(updated.updated ? { updated: updated.updated } : {}),
          syncedAt: nowIso,
        },
        updatedAt: nowIso,
      };
      return events;
    });
    return NextResponse.json({ ok: true, response, removed: response === "declined" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

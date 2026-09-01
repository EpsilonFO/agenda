import { NextResponse } from "next/server";
import { getEvent, updateEvent, deleteEvent } from "@/lib/store";
import { normalizeAttendees, resolveInvite } from "@/lib/google/invites";
import { requestSyncSoon } from "@/lib/google/sync";
import type { EventItem } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Champs que le client a le droit de modifier (le reste est géré par le serveur). */
const EDITABLE = new Set([
  "title",
  "start",
  "end",
  "description",
  "location",
  "category",
  "color",
  "reminderMin",
  "attendees",
]);

export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  const body = (await req.json()) as Record<string, unknown>;
  const current = await getEvent(params.id);
  if (!current) {
    return NextResponse.json({ error: "événement introuvable" }, { status: 404 });
  }
  const patch: Partial<Omit<EventItem, "id" | "createdAt">> = {};
  for (const [k, v] of Object.entries(body)) {
    if (EDITABLE.has(k)) (patch as Record<string, unknown>)[k] = v;
  }
  if ("attendees" in body) {
    const attendees = normalizeAttendees(body.attendees);
    patch.attendees = attendees.length ? attendees : undefined;
    patch.invite = attendees.length
      ? await resolveInvite(
          typeof body.inviteAccountId === "string" ? body.inviteAccountId : undefined,
          current.invite
        )
      : current.invite; // on garde le lien pour que la synchro retire les invités côté Google
  } else if (typeof body.inviteAccountId === "string" && current.attendees?.length) {
    patch.invite = await resolveInvite(body.inviteAccountId, current.invite);
  }
  const event = await updateEvent(params.id, patch);
  if (!event) {
    return NextResponse.json({ error: "événement introuvable" }, { status: 404 });
  }
  requestSyncSoon();
  return NextResponse.json(event);
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const ok = await deleteEvent(params.id);
  if (!ok) {
    return NextResponse.json({ error: "événement introuvable" }, { status: 404 });
  }
  requestSyncSoon();
  return NextResponse.json({ deleted: true });
}

import { NextResponse } from "next/server";
import { getEvent, updateEvent, deleteEvent } from "@/lib/store";
import { normalizeAttendees, resolveInvite } from "@/lib/google/invites";
import { newMeetRequest } from "@/lib/google/meet";
import { requestSyncSoon } from "@/lib/google/sync";
import { normalizeChecklist } from "@/lib/checklist";
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
  "checklist",
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
  // Checklist : la liste reçue remplace l'ancienne (vide = plus de checklist).
  if ("checklist" in body) patch.checklist = normalizeChecklist(body.checklist);
  // Titre après cette modification : il décide du compte qui porte une NOUVELLE invitation.
  const titleNow = typeof body.title === "string" ? body.title : current.title;
  if ("attendees" in body) {
    const attendees = normalizeAttendees(body.attendees);
    patch.attendees = attendees.length ? attendees : undefined;
    patch.invite = attendees.length
      ? await resolveInvite(
          typeof body.inviteAccountId === "string" ? body.inviteAccountId : undefined,
          current.invite,
          titleNow
        )
      : current.invite; // on garde le lien pour que la synchro retire les invités côté Google
  } else if (typeof body.inviteAccountId === "string" && current.attendees?.length) {
    patch.invite = await resolveInvite(body.inviteAccountId, current.invite, titleNow);
  }
  // Visio : demandée une seule fois (garder le requestId, c'est garder la même
  // conférence) ; retirée, elle l'est aussi côté Google par la synchro.
  if (body.visio === true) {
    const invite =
      (patch.invite as { accountId: string } | undefined) ||
      (await resolveInvite(
        typeof body.inviteAccountId === "string" ? body.inviteAccountId : undefined,
        current.invite,
        titleNow
      ));
    if (invite) {
      if (!current.meet) patch.meet = newMeetRequest();
      if (!current.invite) patch.invite = invite;
    }
  } else if (body.visio === false) {
    patch.meet = undefined;
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

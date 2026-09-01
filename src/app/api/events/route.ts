import { NextResponse } from "next/server";
import { listEvents, createEvent } from "@/lib/store";
import { normalizeAttendees, resolveInvite } from "@/lib/google/invites";
import { requestSyncSoon } from "@/lib/google/sync";

export const dynamic = "force-dynamic";

export async function GET() {
  const events = await listEvents();
  return NextResponse.json(events);
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.title || !body.start || !body.end) {
    return NextResponse.json(
      { error: "title, start et end sont requis" },
      { status: 400 }
    );
  }
  // Invités → une invitation Google sera envoyée par la synchro depuis le
  // compte choisi (ou le compte par défaut).
  const attendees = normalizeAttendees(body.attendees);
  const invite = attendees.length ? await resolveInvite(body.inviteAccountId) : undefined;
  const event = await createEvent({
    title: body.title,
    start: body.start,
    end: body.end,
    description: body.description,
    location: body.location,
    category: body.category,
    color: body.color,
    reminderMin: typeof body.reminderMin === "number" ? body.reminderMin : undefined,
    ...(attendees.length ? { attendees } : {}),
    ...(invite ? { invite } : {}),
  });
  requestSyncSoon();
  return NextResponse.json(event, { status: 201 });
}

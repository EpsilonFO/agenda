import { NextResponse } from "next/server";
import { listEvents, createEvent } from "@/lib/store";

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
  const event = await createEvent({
    title: body.title,
    start: body.start,
    end: body.end,
    description: body.description,
    location: body.location,
    category: body.category,
    color: body.color,
  });
  return NextResponse.json(event, { status: 201 });
}

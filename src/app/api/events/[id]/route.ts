import { NextResponse } from "next/server";
import { updateEvent, deleteEvent } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  const body = await req.json();
  const event = await updateEvent(params.id, body);
  if (!event) {
    return NextResponse.json({ error: "événement introuvable" }, { status: 404 });
  }
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
  return NextResponse.json({ deleted: true });
}

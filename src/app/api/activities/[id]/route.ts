import { NextResponse } from "next/server";
import { updateActivity, deleteActivity } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  const body = await req.json();
  const activity = await updateActivity(params.id, body);
  if (!activity) {
    return NextResponse.json({ error: "activité introuvable" }, { status: 404 });
  }
  return NextResponse.json(activity);
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const ok = await deleteActivity(params.id);
  if (!ok) return NextResponse.json({ error: "introuvable" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}

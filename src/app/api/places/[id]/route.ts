import { NextResponse } from "next/server";
import { updatePlace, deletePlace } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  const body = await req.json();
  const place = await updatePlace(params.id, body);
  if (!place) {
    return NextResponse.json({ error: "lieu introuvable" }, { status: 404 });
  }
  return NextResponse.json(place);
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const ok = await deletePlace(params.id);
  if (!ok) return NextResponse.json({ error: "introuvable" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}

import { NextResponse } from "next/server";
import { updateTravelTime, deleteTravelTime } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  const body = await req.json();
  const travel = await updateTravelTime(params.id, body);
  if (!travel) {
    return NextResponse.json({ error: "trajet introuvable" }, { status: 404 });
  }
  return NextResponse.json(travel);
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const ok = await deleteTravelTime(params.id);
  if (!ok) return NextResponse.json({ error: "introuvable" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}

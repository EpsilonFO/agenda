import { NextResponse } from "next/server";
import { updateWorkStream, deleteWorkStream } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const stream = await updateWorkStream(params.id, body);
  if (!stream) {
    return NextResponse.json({ error: "couche introuvable" }, { status: 404 });
  }
  return NextResponse.json(stream);
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const ok = await deleteWorkStream(params.id);
  if (!ok) return NextResponse.json({ error: "introuvable" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}

import { NextResponse } from "next/server";
import { deleteMemory } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const ok = await deleteMemory(params.id);
  if (!ok) {
    return NextResponse.json({ error: "introuvable" }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}

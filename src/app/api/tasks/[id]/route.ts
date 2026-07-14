import { NextResponse } from "next/server";
import { updateTask, deleteTask } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const task = await updateTask(params.id, body);
  if (!task) {
    return NextResponse.json({ error: "tâche introuvable" }, { status: 404 });
  }
  return NextResponse.json(task);
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const ok = await deleteTask(params.id);
  if (!ok) return NextResponse.json({ error: "introuvable" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}

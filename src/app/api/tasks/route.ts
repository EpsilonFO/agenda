import { NextResponse } from "next/server";
import { listTasks, createTask } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listTasks());
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.title || !String(body.title).trim()) {
    return NextResponse.json({ error: "title requis" }, { status: 400 });
  }
  if (!body.dueDate) {
    return NextResponse.json({ error: "dueDate requis" }, { status: 400 });
  }
  const task = await createTask({
    title: String(body.title).trim(),
    streamId: body.streamId ? String(body.streamId) : undefined,
    dueDate: String(body.dueDate),
    estimatedHours: Number(body.estimatedHours) || 2,
    done: Boolean(body.done),
  });
  return NextResponse.json(task, { status: 201 });
}

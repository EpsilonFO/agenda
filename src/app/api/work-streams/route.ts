import { NextResponse } from "next/server";
import { listWorkStreams, createWorkStream } from "@/lib/store";
import type { WorkStream } from "@/lib/types";

export const dynamic = "force-dynamic";

const KINDS = ["master", "startup", "cdd", "autre"];

export async function GET() {
  return NextResponse.json(await listWorkStreams());
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.name || !String(body.name).trim()) {
    return NextResponse.json({ error: "name requis" }, { status: 400 });
  }
  const kind = KINDS.includes(body.kind) ? body.kind : "autre";
  const stream = await createWorkStream({
    name: String(body.name).trim(),
    kind: kind as WorkStream["kind"],
    weeklyHoursTarget:
      body.weeklyHoursTarget != null ? Number(body.weeklyHoursTarget) : undefined,
    placeId: body.placeId ? String(body.placeId) : undefined,
    notes: body.notes ? String(body.notes) : undefined,
  });
  return NextResponse.json(stream, { status: 201 });
}

import { NextResponse } from "next/server";
import { listActivities, createActivity } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listActivities());
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.name || !String(body.name).trim()) {
    return NextResponse.json({ error: "name requis" }, { status: 400 });
  }
  const activity = await createActivity({
    name: String(body.name).trim(),
    category: body.category ? String(body.category) : undefined,
    placeId: body.placeId ? String(body.placeId) : undefined,
    durationMin: Number(body.durationMin) || 60,
    perWeek: body.perWeek != null ? Number(body.perWeek) : undefined,
    preferredWindows: Array.isArray(body.preferredWindows)
      ? body.preferredWindows
      : undefined,
    transportModes: Array.isArray(body.transportModes)
      ? body.transportModes
      : undefined,
    sport: body.sport || undefined,
  });
  return NextResponse.json(activity, { status: 201 });
}

import { NextResponse } from "next/server";
import { listPlaces, createPlace } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listPlaces());
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.name || !String(body.name).trim()) {
    return NextResponse.json({ error: "name requis" }, { status: 400 });
  }
  const place = await createPlace({
    name: String(body.name).trim(),
    type: body.type ? String(body.type) : undefined,
    isHome: Boolean(body.isHome),
  });
  return NextResponse.json(place, { status: 201 });
}

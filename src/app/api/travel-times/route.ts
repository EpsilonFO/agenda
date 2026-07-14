import { NextResponse } from "next/server";
import { listTravelTimes, createTravelTime } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listTravelTimes());
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.fromId || !body.toId || body.minutes == null) {
    return NextResponse.json(
      { error: "fromId, toId et minutes requis" },
      { status: 400 }
    );
  }
  const travel = await createTravelTime({
    fromId: String(body.fromId),
    toId: String(body.toId),
    minutes: Number(body.minutes),
    mode: body.mode ? String(body.mode) : "à pied",
  });
  return NextResponse.json(travel, { status: 201 });
}

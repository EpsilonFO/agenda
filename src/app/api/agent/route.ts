import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.json();
  const history = Array.isArray(body.messages) ? body.messages : [];
  if (history.length === 0) {
    return NextResponse.json({ error: "messages requis" }, { status: 400 });
  }
  const result = await runAgent(history);
  return NextResponse.json(result);
}

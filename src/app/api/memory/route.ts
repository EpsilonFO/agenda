import { NextResponse } from "next/server";
import { listMemory, addMemory } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await listMemory();
  return NextResponse.json(items);
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.content || !String(body.content).trim()) {
    return NextResponse.json({ error: "content requis" }, { status: 400 });
  }
  const item = await addMemory(String(body.content).trim());
  return NextResponse.json(item, { status: 201 });
}

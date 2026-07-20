import { NextResponse } from "next/server";
import { listSessions, createSession } from "@/lib/store";
import { generateSessionTitle } from "@/lib/summary";

export const dynamic = "force-dynamic";

/** GET /api/agent/sessions?mode=agenda — liste les sessions d'un mode. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") || "agenda";
  const sessions = await listSessions(mode);
  return NextResponse.json(sessions);
}

/**
 * POST /api/agent/sessions
 * Body: { mode, firstUserMessage }
 * Crée une nouvelle session et génère son titre via l'IA.
 */
export async function POST(req: Request) {
  const body = await req.json();
  const mode: string = body.mode || "agenda";
  const firstMessage: string = body.firstUserMessage || "";

  const title = await generateSessionTitle(firstMessage, mode);
  const session = await createSession(mode, title);
  return NextResponse.json(session);
}

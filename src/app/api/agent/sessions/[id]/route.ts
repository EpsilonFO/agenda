import { NextResponse } from "next/server";
import { getChatHistory, deleteSession } from "@/lib/store";

export const dynamic = "force-dynamic";

/** GET /api/agent/sessions/[id]?mode=agenda — historique d'une session archivée. */
export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") || "agenda";
  const history = await getChatHistory(mode, params.id);
  return NextResponse.json(history);
}

/** DELETE /api/agent/sessions/[id] — supprime une session et son historique. */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  await deleteSession(params.id);
  return NextResponse.json({ ok: true });
}

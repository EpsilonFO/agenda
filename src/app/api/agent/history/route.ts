import { NextResponse } from "next/server";
import { getChatHistory, clearChatHistory } from "@/lib/store";

export const dynamic = "force-dynamic";

/** GET /api/agent/history?mode=agenda — retourne l'historique d'un mode. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") || "agenda";
  const history = await getChatHistory(mode);
  return NextResponse.json(history);
}

/** DELETE /api/agent/history?mode=agenda — efface l'historique d'un mode. */
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") || "agenda";
  await clearChatHistory(mode);
  return NextResponse.json({ ok: true });
}

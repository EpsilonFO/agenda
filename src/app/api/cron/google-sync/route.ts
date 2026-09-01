import { NextResponse } from "next/server";
import { runGoogleSync } from "@/lib/google/sync";
import { cronAuthorized } from "@/lib/cronAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Synchro Google déclenchable par un cron externe (repli : le serveur la
 * lance déjà tout seul périodiquement, voir src/instrumentation.ts).
 * Même protection que /api/cron/reminders.
 */
async function handle(req: Request) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  }
  const report = await runGoogleSync();
  return NextResponse.json({ ok: true, ...report });
}

export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}

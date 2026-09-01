import { NextResponse } from "next/server";
import { lastSyncReport, runGoogleSync } from "@/lib/google/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Dernier rapport de synchro (mémoire du process). */
export async function GET() {
  return NextResponse.json(lastSyncReport() || { ranAt: null, accounts: [] });
}

/** Synchro immédiate (bouton « Synchroniser maintenant »). Corps optionnel : { accountId }. */
export async function POST(req: Request) {
  let accountId: string | undefined;
  try {
    const body = await req.json();
    if (body && typeof body.accountId === "string") accountId = body.accountId;
  } catch {
    /* corps vide */
  }
  const report = await runGoogleSync({ accountId });
  return NextResponse.json(report);
}

import { NextRequest, NextResponse } from "next/server";
import { listAccounts, toPublic } from "@/lib/google/accounts";
import { googleConfigured, googleRedirectUri, syncWindowDays } from "@/lib/google/config";
import { lastSyncReport } from "@/lib/google/sync";
import { syncTimeZone } from "@/lib/google/time";

export const dynamic = "force-dynamic";

/** État de l'intégration Google pour l'UI : config, comptes (sans secrets), dernier passage. */
export async function GET(req: NextRequest) {
  const accounts = await listAccounts();
  return NextResponse.json({
    configured: googleConfigured(),
    redirectUri: googleRedirectUri(req.nextUrl.origin),
    timeZone: syncTimeZone(),
    window: syncWindowDays(),
    accounts: accounts.map(toPublic),
    lastRun: lastSyncReport(),
  });
}

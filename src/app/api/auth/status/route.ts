import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { listCredentials, sessionSecret } from "@/lib/auth";
import { SESSION_COOKIE, verifySession, authDisabled } from "@/lib/session";

export const dynamic = "force-dynamic";

// Indique à la page /login s'il faut enrôler (aucune passkey) ou déverrouiller,
// et si la session en cours est déjà valide.
export async function GET() {
  // En mode AUTH_DISABLED, on court-circuite : toujours authentifié.
  if (authDisabled()) {
    return NextResponse.json({ registered: true, authenticated: true });
  }
  const creds = await listCredentials();
  const token = cookies().get(SESSION_COOKIE)?.value;
  const session = await verifySession(token, sessionSecret());
  return NextResponse.json({
    registered: creds.length > 0,
    authenticated: Boolean(session),
  });
}

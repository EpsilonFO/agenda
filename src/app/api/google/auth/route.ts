import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { googleConfigured, googleRedirectUri } from "@/lib/google/config";
import { buildAuthUrl } from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

// Pas exporté : un fichier route Next n'accepte que ses exports réservés.
const STATE_COOKIE = "agenda_google_state";

/**
 * Démarre la connexion d'un compte Google : pose un `state` anti-CSRF en
 * cookie puis redirige vers l'écran de consentement Google. Optionnel :
 * `?email=` pré-sélectionne le compte (login_hint).
 */
export async function GET(req: NextRequest) {
  if (!googleConfigured()) {
    return NextResponse.redirect(
      new URL("/reglages?google=error&reason=" + encodeURIComponent("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET manquants"), req.url)
    );
  }
  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = googleRedirectUri(req.nextUrl.origin);
  const url = buildAuthUrl({
    state,
    redirectUri,
    loginHint: req.nextUrl.searchParams.get("email") || undefined,
  });
  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: redirectUri.startsWith("https://"),
    path: "/api/google",
    maxAge: 600,
  });
  return res;
}

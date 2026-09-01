import { NextRequest, NextResponse } from "next/server";
import { googleConfigured, googleRedirectUri } from "@/lib/google/config";
import { decodeIdToken, exchangeCode, fetchUserInfo } from "@/lib/google/oauth";
import { upsertAccountByEmail } from "@/lib/google/accounts";
import { requestSyncSoon } from "@/lib/google/sync";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "agenda_google_state";

function back(req: NextRequest, params: Record<string, string>): NextResponse {
  const url = new URL("/reglages", req.nextUrl.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, "", { path: "/api/google", maxAge: 0 });
  return res;
}

/**
 * Retour du consentement Google : vérifie le `state`, échange le code contre
 * les jetons, identifie le compte (email) et l'enregistre. Puis retour aux
 * réglages, et un premier passage de synchro est programmé.
 */
export async function GET(req: NextRequest) {
  if (!googleConfigured()) return back(req, { google: "error", reason: "Google non configuré" });

  const q = req.nextUrl.searchParams;
  const denied = q.get("error");
  if (denied) return back(req, { google: "error", reason: `accès refusé (${denied})` });

  const code = q.get("code");
  const state = q.get("state");
  const expected = req.cookies.get(STATE_COOKIE)?.value;
  if (!code || !state || !expected || state !== expected) {
    return back(req, { google: "error", reason: "état OAuth invalide — recommence la connexion" });
  }

  try {
    const redirectUri = googleRedirectUri(req.nextUrl.origin);
    const tok = await exchangeCode(code, redirectUri);
    if (!tok.refresh_token) {
      return back(req, {
        google: "error",
        reason:
          "Google n'a pas renvoyé de refresh token. Retire l'accès de l'app dans myaccount.google.com/permissions puis reconnecte.",
      });
    }
    let identity = tok.id_token ? decodeIdToken(tok.id_token) : {};
    if (!identity.email) identity = await fetchUserInfo(tok.access_token);
    if (!identity.email) {
      return back(req, { google: "error", reason: "impossible de lire l'adresse email du compte" });
    }
    const now = new Date();
    const account = await upsertAccountByEmail(
      {
        email: identity.email,
        name: identity.name,
        refreshToken: tok.refresh_token,
        accessToken: tok.access_token,
        accessTokenExpiresAt: new Date(now.getTime() + (tok.expires_in || 3600) * 1000).toISOString(),
        scope: tok.scope,
      },
      now.toISOString()
    );
    requestSyncSoon(1000);
    return back(req, { google: "ok", email: account.email });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[google-oauth] callback :", message);
    return back(req, { google: "error", reason: message.slice(0, 200) });
  }
}

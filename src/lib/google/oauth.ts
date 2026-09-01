import { googleClientId, googleClientSecret, SCOPES } from "./config";

/**
 * OAuth 2.0 « application web » de Google, en fetch pur (pas de SDK).
 * Le flux : /api/google/auth redirige vers le consentement Google →
 * /api/google/callback échange le code contre un refresh token, stocké dans
 * data/google-accounts.json. Le refresh token sert ensuite à obtenir des
 * access tokens (1 h) à la demande.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/** Le refresh token est mort (révoqué, expiré, mot de passe changé…) : reconnexion requise. */
export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

export function buildAuthUrl(opts: {
  state: string;
  redirectUri: string;
  loginHint?: string;
}): string {
  const params = new URLSearchParams({
    client_id: googleClientId(),
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    // offline + consent : indispensable pour recevoir un refresh token (et en
    // recevoir un NOUVEAU à chaque reconnexion, même si déjà autorisé).
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: opts.state,
  });
  if (opts.loginHint) params.set("login_hint", opts.loginHint);
  return `${AUTH_URL}?${params.toString()}`;
}

export type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  token_type?: string;
};

async function postForm(url: string, form: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
}

export async function exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const res = await postForm(TOKEN_URL, {
    code,
    client_id: googleClientId(),
    client_secret: googleClientSecret(),
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      `échange du code refusé (${res.status}) : ${String(data.error || "")} ${String(
        data.error_description || ""
      )}`.trim()
    );
  }
  return data as unknown as TokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await postForm(TOKEN_URL, {
    refresh_token: refreshToken,
    client_id: googleClientId(),
    client_secret: googleClientSecret(),
    grant_type: "refresh_token",
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = String(data.error || "");
    const desc = String(data.error_description || "");
    // invalid_grant = jeton révoqué/expiré → il faut refaire le consentement.
    if (res.status === 400 || res.status === 401 || err === "invalid_grant") {
      throw new GoogleAuthError(`reconnexion requise (${err || res.status}) ${desc}`.trim());
    }
    throw new Error(`rafraîchissement du jeton échoué (${res.status}) : ${err} ${desc}`.trim());
  }
  return data as unknown as TokenResponse;
}

/** Révocation (meilleur effort) : ne lève jamais. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await postForm(REVOKE_URL, { token });
  } catch {
    /* ignoré */
  }
}

/**
 * Lit l'identité dans l'id_token (JWT) renvoyé par le endpoint token. Pas de
 * vérification de signature : il vient DIRECTEMENT de Google en TLS, pas d'un
 * tiers. Repli sur /userinfo si absent.
 */
export function decodeIdToken(idToken: string): { email?: string; name?: string; sub?: string } {
  try {
    const payload = idToken.split(".")[1];
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8"
    );
    const p = JSON.parse(json) as Record<string, unknown>;
    return {
      email: typeof p.email === "string" ? p.email : undefined,
      name: typeof p.name === "string" ? p.name : undefined,
      sub: typeof p.sub === "string" ? p.sub : undefined,
    };
  } catch {
    return {};
  }
}

export async function fetchUserInfo(accessToken: string): Promise<{ email?: string; name?: string }> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return {};
  const p = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    email: typeof p.email === "string" ? p.email : undefined,
    name: typeof p.name === "string" ? p.name : undefined,
  };
}

/**
 * Cookie de session signé (HMAC-SHA256), 100% Web Crypto pour fonctionner
 * aussi bien dans le middleware (runtime edge) que dans les routes API (node).
 * N'importe AUCUN module Node ici.
 */

export const SESSION_COOKIE = "agenda_session";
export const CHALLENGE_COOKIE = "agenda_challenge";

type Payload = { sub: string; exp: number };

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesFromB64url(s: string): Uint8Array {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = t.length % 4 ? 4 - (t.length % 4) : 0;
  t += "=".repeat(pad);
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return b64urlFromBytes(new Uint8Array(sig));
}

/** Comparaison à temps constant (évite les attaques temporelles). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Crée un jeton de session valable `days` jours pour le sujet `sub`. */
export async function signSession(
  sub: string,
  secret: string,
  days: number
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + days * 24 * 60 * 60;
  const payload: Payload = { sub, exp };
  const body = b64urlFromBytes(enc.encode(JSON.stringify(payload)));
  const sig = await hmac(body, secret);
  return `${body}.${sig}`;
}

/** Vérifie signature + expiration. Renvoie le payload ou null. */
export async function verifySession(
  token: string | undefined,
  secret: string
): Promise<Payload | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = await hmac(body, secret);
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(dec.decode(bytesFromB64url(body))) as Payload;
    if (typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

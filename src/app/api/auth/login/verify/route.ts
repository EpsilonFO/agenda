import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import {
  RP_ID,
  ORIGIN,
  listCredentials,
  updateCounter,
  decodePublicKey,
  sessionSecret,
  sessionDays,
  cookieSecure,
} from "@/lib/auth";
import { CHALLENGE_COOKIE, SESSION_COOKIE, signSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Étape 2 du déverrouillage : vérifie l'assertion et ouvre la session.
export async function POST(req: Request) {
  const body = (await req.json()) as { response?: AuthenticationResponseJSON };
  const expectedChallenge = cookies().get(CHALLENGE_COOKIE)?.value;
  if (!body.response || !expectedChallenge) {
    return NextResponse.json({ error: "requête invalide" }, { status: 400 });
  }

  const creds = await listCredentials();
  const cred = creds.find((c) => c.id === body.response!.id);
  if (!cred) {
    return NextResponse.json({ error: "passkey inconnue" }, { status: 400 });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
      credential: {
        id: cred.id,
        publicKey: decodePublicKey(cred.publicKey),
        counter: cred.counter,
        transports: cred.transports,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "vérification échouée" },
      { status: 400 }
    );
  }

  if (!verification.verified) {
    return NextResponse.json({ error: "authentification refusée" }, { status: 401 });
  }

  await updateCounter(cred.id, verification.authenticationInfo.newCounter);

  const jar = cookies();
  jar.delete(CHALLENGE_COOKIE);
  const token = await signSession("felix", sessionSecret(), sessionDays());
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: sessionDays() * 24 * 60 * 60,
  });

  return NextResponse.json({ verified: true });
}

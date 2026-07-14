import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import {
  RP_ID,
  ORIGIN,
  saveCredential,
  encodePublicKey,
  sessionSecret,
  sessionDays,
  cookieSecure,
} from "@/lib/auth";
import { CHALLENGE_COOKIE, SESSION_COOKIE, signSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Étape 2 de l'enrôlement : vérifie l'attestation et enregistre la passkey,
// puis ouvre une session (l'appareil qui vient de s'enrôler est de confiance).
export async function POST(req: Request) {
  const enrollCode = process.env.ENROLL_CODE;
  if (!enrollCode || req.headers.get("x-enroll-code") !== enrollCode) {
    return NextResponse.json({ error: "code d'enrôlement invalide" }, { status: 403 });
  }

  const body = (await req.json()) as {
    response?: RegistrationResponseJSON;
    label?: string;
  };
  const expectedChallenge = cookies().get(CHALLENGE_COOKIE)?.value;
  if (!body.response || !expectedChallenge) {
    return NextResponse.json({ error: "requête invalide" }, { status: 400 });
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "vérification échouée" },
      { status: 400 }
    );
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: "attestation refusée" }, { status: 400 });
  }

  const { credential } = verification.registrationInfo;
  await saveCredential({
    id: credential.id,
    publicKey: encodePublicKey(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports,
    label: body.label?.slice(0, 40),
    createdAt: new Date().toISOString(),
  });

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

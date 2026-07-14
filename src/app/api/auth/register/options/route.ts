import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import {
  RP_ID,
  RP_NAME,
  USER_NAME,
  USER_ID,
  listCredentials,
  cookieSecure,
} from "@/lib/auth";
import { CHALLENGE_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

// Étape 1 de l'enrôlement d'un appareil. Protégée par le code d'enrôlement
// (en-tête x-enroll-code) pour éviter qu'un inconnu enregistre SA passkey.
export async function POST(req: Request) {
  const enrollCode = process.env.ENROLL_CODE;
  if (!enrollCode) {
    return NextResponse.json(
      { error: "enrôlement désactivé (ENROLL_CODE manquant)" },
      { status: 403 }
    );
  }
  if (req.headers.get("x-enroll-code") !== enrollCode) {
    return NextResponse.json({ error: "code d'enrôlement invalide" }, { status: 403 });
  }

  const existing = await listCredentials();
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: USER_NAME,
    userID: USER_ID,
    attestationType: "none",
    // Empêche d'enregistrer deux fois la même passkey sur un appareil déjà connu.
    excludeCredentials: existing.map((c) => ({
      id: c.id,
      transports: c.transports,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
      // Face ID / Touch ID / Windows Hello (authentificateur intégré).
      authenticatorAttachment: "platform",
    },
  });

  cookies().set(CHALLENGE_COOKIE, options.challenge, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: 300,
  });

  return NextResponse.json(options);
}

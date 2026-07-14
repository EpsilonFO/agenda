import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { RP_ID, listCredentials, cookieSecure } from "@/lib/auth";
import { CHALLENGE_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

// Étape 1 du déverrouillage : propose au navigateur les passkeys connues.
export async function POST() {
  const creds = await listCredentials();
  if (creds.length === 0) {
    return NextResponse.json({ error: "aucune passkey enregistrée" }, { status: 400 });
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "required",
    allowCredentials: creds.map((c) => ({
      id: c.id,
      transports: c.transports,
    })),
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

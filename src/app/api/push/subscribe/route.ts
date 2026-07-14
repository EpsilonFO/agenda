import { NextResponse } from "next/server";
import {
  addSubscription,
  removeSubscription,
  type StoredSubscription,
} from "@/lib/push";

export const dynamic = "force-dynamic";

// Enregistre l'abonnement push d'un appareil.
export async function POST(req: Request) {
  const body = (await req.json()) as {
    subscription?: StoredSubscription;
    ua?: string;
  };
  const sub = body.subscription;
  if (!sub?.endpoint || !sub.keys?.auth || !sub.keys?.p256dh) {
    return NextResponse.json(
      { error: "abonnement invalide" },
      { status: 400 }
    );
  }
  // Horodatage passé par le serveur (pas de Date côté module partagé).
  await addSubscription({ ...sub, ua: body.ua }, new Date().toISOString());
  return NextResponse.json({ ok: true }, { status: 201 });
}

// Désabonne un appareil (via son endpoint).
export async function DELETE(req: Request) {
  const body = (await req.json()) as { endpoint?: string };
  if (!body.endpoint) {
    return NextResponse.json({ error: "endpoint requis" }, { status: 400 });
  }
  await removeSubscription(body.endpoint);
  return NextResponse.json({ ok: true });
}

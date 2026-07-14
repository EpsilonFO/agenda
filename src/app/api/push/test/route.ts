import { NextResponse } from "next/server";
import { sendToAll } from "@/lib/push";

export const dynamic = "force-dynamic";

// Envoie une notification de test à tous les appareils abonnés.
export async function POST() {
  const sent = await sendToAll({
    title: "Agenda IA",
    body: "Les notifications fonctionnent 🎉",
    url: "/",
    tag: "test",
  });
  return NextResponse.json({ sent });
}

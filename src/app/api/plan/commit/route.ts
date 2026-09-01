import { NextResponse } from "next/server";
import { commitWeekPlan } from "@/lib/commit";
import { requestSyncSoon } from "@/lib/google/sync";
import type { WeekPlan } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Écrit un plan de semaine validé dans l'agenda (idempotent). Utilisé en repli
 * si l'utilisateur veut valider manuellement ; le Conseil applique désormais
 * ses plans directement.
 */
export async function POST(req: Request) {
  const body = await req.json();
  const plan: WeekPlan = body.plan || body;
  if (!Array.isArray(plan.sessions) || plan.sessions.length === 0) {
    return NextResponse.json({ error: "sessions requises" }, { status: 400 });
  }
  const created = await commitWeekPlan(plan);
  requestSyncSoon();
  return NextResponse.json({ created }, { status: 201 });
}

import { NextResponse } from "next/server";
import { commitWeekPlan } from "@/lib/commit";
import type { WeekPlan } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Écrit un plan de semaine VALIDÉ dans l'agenda (idempotent) et le persiste
 * avec sa demande d'origine (`input`, base des replanifications). C'est le
 * bouton Valider de la carte : depuis la v5.1, le planificateur ne fait que
 * PROPOSER — rien n'est écrit sans ce passage.
 */
export async function POST(req: Request) {
  const body = await req.json();
  const plan: WeekPlan = body.plan || body;
  if (!Array.isArray(plan.sessions) || plan.sessions.length === 0) {
    return NextResponse.json({ error: "sessions requises" }, { status: 400 });
  }
  const created = await commitWeekPlan(plan);
  return NextResponse.json({ created }, { status: 201 });
}

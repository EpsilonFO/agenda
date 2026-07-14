import { NextResponse } from "next/server";
import { getWeekPlan } from "@/lib/store";
import { startOfWeek, parseFlexibleDate, toLocalIso } from "@/lib/dates";

export const dynamic = "force-dynamic";

/** Renvoie le plan de semaine validé pour une semaine donnée (?weekStart=…). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const weekStartParam = url.searchParams.get("weekStart") || undefined;
  const weekStart = toLocalIso(
    startOfWeek(parseFlexibleDate(weekStartParam))
  ).slice(0, 10);
  const plan = await getWeekPlan(weekStart);
  return NextResponse.json(plan);
}

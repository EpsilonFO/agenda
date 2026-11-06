import { NextResponse } from "next/server";
import { dismissPreviews, listDismissedPreviews } from "@/lib/dismissedPreviews";

export const dynamic = "force-dynamic";

/** Ids des aperçus de sports imposés écartés à la main. */
export async function GET() {
  return NextResponse.json(await listDismissedPreviews());
}

/** Écarte des aperçus : { ids: ["fixed-sport:natation:2026-11-12", …] }. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }
  const ids = (body as { ids?: unknown })?.ids;
  if (
    !Array.isArray(ids) ||
    !ids.every((id) => typeof id === "string" && /^fixed-sport:[^:]+:\d{4}-\d{2}-\d{2}$/.test(id))
  ) {
    return NextResponse.json({ error: "ids invalides" }, { status: 400 });
  }
  return NextResponse.json(await dismissPreviews(ids));
}

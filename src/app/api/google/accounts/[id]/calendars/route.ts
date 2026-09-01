import { NextResponse } from "next/server";
import { getAccount } from "@/lib/google/accounts";
import { listCalendars } from "@/lib/google/client";

export const dynamic = "force-dynamic";

/** Calendriers modifiables du compte (pour choisir lequel synchroniser). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const account = await getAccount(params.id);
  if (!account) return NextResponse.json({ error: "compte introuvable" }, { status: 404 });
  try {
    const items = await listCalendars(account);
    return NextResponse.json(
      items.map((c) => ({
        id: c.id,
        summary: c.summaryOverride || c.summary || c.id,
        primary: Boolean(c.primary),
        accessRole: c.accessRole,
      }))
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

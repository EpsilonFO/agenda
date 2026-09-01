import { NextResponse } from "next/server";
import { loadLifeConfig, parseLifeConfig, saveLifeConfig } from "@/lib/planner/config";

export const dynamic = "force-dynamic";

/** La config de vie, parsée (défauts matérialisés) — ce que l'UI édite. */
export async function GET() {
  try {
    return NextResponse.json(await loadLifeConfig());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "config illisible" },
      { status: 500 }
    );
  }
}

/**
 * Remplace la config ENTIÈRE après validation zod (cohérence référentielle
 * incluse). Une config invalide n'écrase jamais le fichier : 400 + détails
 * lisibles, l'UI les affiche tels quels.
 */
export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }
  try {
    const cfg = parseLifeConfig(body);
    await saveLifeConfig(cfg);
    return NextResponse.json(cfg);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "config invalide" },
      { status: 400 }
    );
  }
}

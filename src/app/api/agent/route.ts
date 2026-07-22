import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";
import { appendChatHistory } from "@/lib/store";
import { buildConversationContext, maybeSummarize } from "@/lib/summary";

export const dynamic = "force-dynamic";
// Un Conseil complet (3 émetteurs + Josiane avec re-prompts + Simone) peut être long.
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json();
  const history = Array.isArray(body.messages) ? body.messages : [];
  if (history.length === 0) {
    return NextResponse.json({ error: "messages requis" }, { status: 400 });
  }

  const mode: string = body.mode || "agenda";
  const sessionId: string | undefined = body.sessionId || undefined;
  const now = new Date().toISOString();

  // Récupère le dernier message utilisateur.
  const lastUser = [...history].reverse().find((m: { role: string }) => m.role === "user");

  // Injecte la mémoire de conversation (session courante) dans le contexte.
  const conversationContext = await buildConversationContext(mode, sessionId);

  const result = await runAgent(history, {
    mode: body.mode,
    now: body.now,
    conversationContext,
  });

  // Persiste user + assistant dans l'historique de la session.
  if (lastUser?.content) {
    await appendChatHistory(mode, {
      role: "user",
      content: String(lastUser.content),
      createdAt: now,
    }, sessionId);
  }
  await appendChatHistory(mode, {
    role: "assistant",
    content: result.reply,
    actions: result.actions,
    createdAt: new Date().toISOString(),
  }, sessionId);

  // Résumé automatique si l'historique est trop long (non bloquant).
  maybeSummarize(mode, sessionId).catch(() => {});

  return NextResponse.json(result);
}

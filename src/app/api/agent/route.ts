import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";
import { appendChatHistory } from "@/lib/store";
import { buildConversationContext, maybeSummarize } from "@/lib/summary";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.json();
  const history = Array.isArray(body.messages) ? body.messages : [];
  if (history.length === 0) {
    return NextResponse.json({ error: "messages requis" }, { status: 400 });
  }

  const mode: string = body.mode || "agenda";
  const now = new Date().toISOString();

  // Récupère le dernier message utilisateur (le plus récent dans history).
  const lastUser = [...history].reverse().find((m: { role: string }) => m.role === "user");

  // Injecte la mémoire de conversation dans le contexte de l'agent.
  const conversationContext = await buildConversationContext(mode);

  const result = await runAgent(history, {
    mode: body.mode,
    now: body.now,
    conversationContext,
  });

  // Persiste le message utilisateur + la réponse de l'agent.
  if (lastUser?.content) {
    await appendChatHistory(mode, {
      role: "user",
      content: String(lastUser.content),
      createdAt: now,
    });
  }
  await appendChatHistory(mode, {
    role: "assistant",
    content: result.reply,
    actions: result.actions,
    createdAt: new Date().toISOString(),
  });

  // Résumé automatique si l'historique est trop long (non bloquant).
  maybeSummarize(mode).catch(() => {});

  return NextResponse.json(result);
}

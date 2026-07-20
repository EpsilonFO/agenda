"use client";

import { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import type { WeekPlan, ChatHistoryEntry, Session } from "@/lib/types";
import { toLocalIso } from "@/lib/dates";
import { AGENT_META, AGENT_ORDER, type ChatMode } from "@/lib/agents";

export type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  actions?: string[];
  plan?: WeekPlan;
  planCommitted?: boolean;
};

const SUGGESTIONS: Record<ChatMode, string[]> = {
  agenda: [
    "Ajoute un d\u00e9jeuner avec Paul jeudi \u00e0 12h30",
    "D\u00e9place mon rdv de mardi \u00e0 15h",
    "Supprime l'\u00e9v\u00e9nement de vendredi soir",
  ],
  council: [
    "Organise ma semaine : 10h Delos, TP jeudi, salle 3x, soir\u00e9e Marine",
    "Planifie la semaine prochaine, je suis chez mes parents le week-end",
  ],
  josiane: ["R\u00e9organise ma journ\u00e9e de demain", "D\u00e9cale ma semaine d'un cran"],
  emilien: ["O\u00f9 j'en suis sur mes heures Delos ?", "Aide-moi \u00e0 prioriser mes TP"],
  jannik: ["C'est quoi ma s\u00e9ance maintenant ?", "Un exercice de remplacement ?"],
  djimo: ["Une id\u00e9e de sortie avec Marine ce week-end ?", "J'ai un moment libre l\u00e0 ?"],
  simone: ["C'est quoi le plat de ce soir ?", "Une variante v\u00e9g\u00e9 pour ce midi ?"],
};

function welcomeFor(mode: ChatMode): ChatMsg {
  if (mode === "agenda") {
    return {
      role: "assistant",
      content:
        "Assistant agenda. Dis-moi ce que tu veux ajouter, d\u00e9placer ou supprimer. Pour organiser toute ta semaine (travail, sport, loisir, repas), ouvre une nouvelle s\u00e9ance du Conseil.",
    };
  }
  if (mode === "council") {
    return {
      role: "assistant",
      content:
        "Nouvelle s\u00e9ance du Conseil. D\u00e9cris tes contraintes de la semaine \u2014 travail, TP et \u00e9ch\u00e9ances, s\u00e9ances de sport, moments perso, jours chez tes parents, voiture \u2014 et les 5 agents organisent tout, repas compris.",
    };
  }
  return { role: "assistant", content: AGENT_META[mode].welcome };
}

function initialConvos(): Record<ChatMode, ChatMsg[]> {
  const modes: ChatMode[] = ["agenda", "council", ...AGENT_ORDER];
  return Object.fromEntries(modes.map((m) => [m, [welcomeFor(m)]])) as Record<ChatMode, ChatMsg[]>;
}

export type AgentChat = {
  mode: ChatMode;
  setMode: (m: ChatMode) => void;
  startCouncil: () => void;
  messages: ChatMsg[];
  suggestions: string[];
  input: string;
  loading: boolean;
  setInput: Dispatch<SetStateAction<string>>;
  send: (text?: string) => Promise<void>;
  commitPlan: (index: number) => Promise<void>;
  activeSession: Session | null;
  sessions: Session[];
  loadSession: (session: Session) => Promise<void>;
  newConversation: () => void;
  deleteSession: (id: string) => Promise<void>;
};

export function useAgentChat(onChanged: () => void): AgentChat {
  const [convos, setConvos] = useState<Record<ChatMode, ChatMsg[]>>(initialConvos);
  const [mode, setMode] = useState<ChatMode>("agenda");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionIds, setSessionIds] = useState<Partial<Record<ChatMode, string>>>({});
  const [activeSessions, setActiveSessions] = useState<Partial<Record<ChatMode, Session>>>({});
  const [sessionsList, setSessionsList] = useState<Partial<Record<ChatMode, Session[]>>>({});

  const currentSessionId = sessionIds[mode];
  const activeSession = activeSessions[mode] ?? null;
  const sessions = sessionsList[mode] ?? [];

  // Charge l'historique courant + liste des sessions au montage.
  useEffect(() => {
    const modes: ChatMode[] = ["agenda", "council", ...AGENT_ORDER];
    modes.forEach(async (m) => {
      try {
        const [histRes, sessRes] = await Promise.all([
          fetch(`/api/agent/history?mode=${m}`),
          fetch(`/api/agent/sessions?mode=${m}`),
        ]);
        if (sessRes.ok) {
          const list: Session[] = await sessRes.json();
          setSessionsList((prev) => ({ ...prev, [m]: list }));
        }
        if (histRes.ok) {
          const entries: ChatHistoryEntry[] = await histRes.json();
          const msgs: ChatMsg[] = entries
            .filter((e) => e.role !== "summary")
            .map((e) => ({
              role: e.role as "user" | "assistant",
              content: e.content,
              actions: e.actions,
            }));
          if (msgs.length > 0) {
            setConvos((prev) => ({ ...prev, [m]: [welcomeFor(m as ChatMode), ...msgs] }));
          }
        }
      } catch {
        // non critique
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCouncil = useCallback(() => {
    setConvos((prev) => ({ ...prev, council: [welcomeFor("council")] }));
    setSessionIds((prev) => ({ ...prev, council: undefined }));
    setActiveSessions((prev) => ({ ...prev, council: undefined }));
    setMode("council");
  }, []);

  /** Charge une session archiv\u00e9e dans le panneau. */
  const loadSession = useCallback(async (session: Session) => {
    const m = session.mode as ChatMode;
    try {
      const res = await fetch(`/api/agent/sessions/${session.id}?mode=${m}`);
      if (!res.ok) return;
      const entries: ChatHistoryEntry[] = await res.json();
      const msgs: ChatMsg[] = entries
        .filter((e) => e.role !== "summary")
        .map((e) => ({
          role: e.role as "user" | "assistant",
          content: e.content,
          actions: e.actions,
        }));
      setConvos((prev) => ({ ...prev, [m]: [welcomeFor(m), ...msgs] }));
      setSessionIds((prev) => ({ ...prev, [m]: session.id }));
      setActiveSessions((prev) => ({ ...prev, [m]: session }));
      setMode(m);
    } catch {
      // non critique
    }
  }, []);

  /** D\u00e9marre une nouvelle conversation vierge pour le mode courant. */
  const newConversation = useCallback(() => {
    setConvos((prev) => ({ ...prev, [mode]: [welcomeFor(mode)] }));
    setSessionIds((prev) => ({ ...prev, [mode]: undefined }));
    setActiveSessions((prev) => ({ ...prev, [mode]: undefined }));
  }, [mode]);

  /** Supprime une session archiv\u00e9e. */
  const deleteSession = useCallback(async (id: string) => {
    try {
      await fetch(`/api/agent/sessions/${id}`, { method: "DELETE" });
      setSessionsList((prev) => ({
        ...prev,
        [mode]: (prev[mode] ?? []).filter((s) => s.id !== id),
      }));
      // Si c'\u00e9tait la session active, revenir \u00e0 la conversation courante.
      if (currentSessionId === id) {
        setConvos((prev) => ({ ...prev, [mode]: [welcomeFor(mode)] }));
        setSessionIds((prev) => ({ ...prev, [mode]: undefined }));
        setActiveSessions((prev) => ({ ...prev, [mode]: undefined }));
      }
    } catch {
      // non critique
    }
  }, [mode, currentSessionId]);

  const send = useCallback(
    async (text?: string) => {
      const content = (text ?? input).trim();
      if (!content || loading) return;
      setInput("");

      const activeMode = mode;
      const sessionId = sessionIds[activeMode];
      const isFirstUserMsg = convos[activeMode].filter((m) => m.role === "user").length === 0;

      const history = [
        ...convos[activeMode],
        { role: "user" as const, content },
      ];
      setConvos((prev) => ({ ...prev, [activeMode]: history }));
      setLoading(true);

      try {
        // Si c'est le 1er message et pas de session active, cr\u00e9er la session en arri\u00e8re-plan.
        let resolvedSessionId = sessionId;
        if (isFirstUserMsg && !sessionId) {
          fetch("/api/agent/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: activeMode, firstUserMessage: content }),
          })
            .then((r) => r.json())
            .then((session: Session) => {
              setSessionIds((prev) => ({ ...prev, [activeMode]: session.id }));
              setActiveSessions((prev) => ({ ...prev, [activeMode]: session }));
              setSessionsList((prev) => ({
                ...prev,
                [activeMode]: [session, ...(prev[activeMode] ?? [])],
              }));
            })
            .catch(() => {});
        }

        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history.map((m) => ({ role: m.role, content: m.content })),
            mode: activeMode,
            now: toLocalIso(new Date()),
            sessionId: resolvedSessionId,
          }),
        });
        const data = await res.json();
        setConvos((prev) => ({
          ...prev,
          [activeMode]: [
            ...prev[activeMode],
            {
              role: "assistant",
              content: data.reply || "\u2026",
              actions: data.actions,
              plan: data.plan,
              planCommitted: data.plan?.committed,
            },
          ],
        }));
        if (data.changed) onChanged();
      } catch {
        setConvos((prev) => ({
          ...prev,
          [activeMode]: [
            ...prev[activeMode],
            { role: "assistant", content: "\u274c Impossible de contacter l'agent." },
          ],
        }));
      } finally {
        setLoading(false);
      }
    },
    [input, loading, mode, convos, sessionIds, onChanged]
  );

  const commitPlan = useCallback(
    async (index: number) => {
      const activeMode = mode;
      const msg = convos[activeMode][index];
      if (!msg?.plan || msg.planCommitted || loading) return;
      setLoading(true);
      try {
        const res = await fetch("/api/plan/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: msg.plan }),
        });
        const data = await res.json();
        setConvos((prev) => ({
          ...prev,
          [activeMode]: [
            ...prev[activeMode].map((m, i) =>
              i === index ? { ...m, planCommitted: true } : m
            ),
            {
              role: "assistant",
              content: `C'est valid\u00e9 \u2014 ${
                data.created ?? msg.plan!.sessions.length
              } s\u00e9ance(s) ajout\u00e9e(s) \u00e0 ton agenda.`,
            },
          ],
        }));
        onChanged();
      } catch {
        setConvos((prev) => ({
          ...prev,
          [activeMode]: [
            ...prev[activeMode],
            { role: "assistant", content: "\u274c Impossible d'\u00e9crire le plan." },
          ],
        }));
      } finally {
        setLoading(false);
      }
    },
    [mode, convos, loading, onChanged]
  );

  const suggestions = useMemo(() => SUGGESTIONS[mode] || [], [mode]);

  return {
    mode,
    setMode,
    startCouncil,
    messages: convos[mode],
    suggestions,
    input,
    loading,
    setInput,
    send,
    commitPlan,
    activeSession,
    sessions,
    loadSession,
    newConversation,
    deleteSession,
  };
}

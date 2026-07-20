"use client";

import { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import type { WeekPlan, ChatHistoryEntry } from "@/lib/types";
import { toLocalIso } from "@/lib/dates";
import { AGENT_META, AGENT_ORDER, type ChatMode } from "@/lib/agents";

export type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  actions?: string[];
  /** Plan de semaine proposé/appliqué, affiché dans la bulle. */
  plan?: WeekPlan;
  /** true une fois le plan écrit dans l'agenda. */
  planCommitted?: boolean;
};

/** Amorces de conversation par mode. */
const SUGGESTIONS: Record<ChatMode, string[]> = {
  agenda: [
    "Ajoute un déjeuner avec Paul jeudi à 12h30",
    "Déplace mon rdv de mardi à 15h",
    "Supprime l'événement de vendredi soir",
  ],
  council: [
    "Organise ma semaine : 10h Delos, TP jeudi, salle 3x, soirée Marine",
    "Planifie la semaine prochaine, je suis chez mes parents le week-end",
  ],
  josiane: ["Réorganise ma journée de demain", "Décale ma semaine d'un cran"],
  emilien: ["Où j'en suis sur mes heures Delos ?", "Aide-moi à prioriser mes TP"],
  jannik: ["C'est quoi ma séance maintenant ?", "Un exercice de remplacement ?"],
  djimo: ["Une idée de sortie avec Marine ce week-end ?", "J'ai un moment libre là ?"],
  simone: ["C'est quoi le plat de ce soir ?", "Une variante végé pour ce midi ?"],
};

function welcomeFor(mode: ChatMode): ChatMsg {
  if (mode === "agenda") {
    return {
      role: "assistant",
      content:
        "Assistant agenda. Dis-moi ce que tu veux ajouter, déplacer ou supprimer. Pour organiser toute ta semaine (travail, sport, loisir, repas), ouvre une nouvelle séance du Conseil.",
    };
  }
  if (mode === "council") {
    return {
      role: "assistant",
      content:
        "Nouvelle séance du Conseil. Décris tes contraintes de la semaine — travail, TP et échéances, séances de sport, moments perso, jours chez tes parents, voiture — et les 5 agents organisent tout, repas compris.",
    };
  }
  return { role: "assistant", content: AGENT_META[mode].welcome };
}

function initialConvos(): Record<ChatMode, ChatMsg[]> {
  const modes: ChatMode[] = ["agenda", "council", ...AGENT_ORDER];
  return Object.fromEntries(modes.map((m) => [m, [welcomeFor(m)]])) as Record<
    ChatMode,
    ChatMsg[]
  >;
}

export type AgentChat = {
  mode: ChatMode;
  setMode: (m: ChatMode) => void;
  /** Ouvre une NOUVELLE séance du Conseil (conversation repartie de zéro). */
  startCouncil: () => void;
  messages: ChatMsg[];
  suggestions: string[];
  input: string;
  loading: boolean;
  setInput: Dispatch<SetStateAction<string>>;
  send: (text?: string) => Promise<void>;
  commitPlan: (index: number) => Promise<void>;
};

/**
 * État partagé des conversations avec le Conseil. Une conversation par mode
 * (agenda simple, séance du Conseil, et un fil par agent), l'historique de
 * chacune étant conservé quand on bascule de l'un à l'autre.
 */
export function useAgentChat(onChanged: () => void): AgentChat {
  const [convos, setConvos] = useState<Record<ChatMode, ChatMsg[]>>(initialConvos);
  const [mode, setMode] = useState<ChatMode>("agenda");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // Charge l'historique persisté au premier montage pour chaque mode.
  useEffect(() => {
    const modes: ChatMode[] = ["agenda", "council", "josiane", "emilien", "jannik", "djimo", "simone"];
    modes.forEach(async (m) => {
      try {
        const res = await fetch(`/api/agent/history?mode=${m}`);
        if (!res.ok) return;
        const entries: ChatHistoryEntry[] = await res.json();
        if (entries.length === 0) return;
        // Convertit les entrées persistées en ChatMsg (hors "summary" qui est interne).
        const msgs: ChatMsg[] = entries
          .filter((e) => e.role !== "summary")
          .map((e) => ({
            role: e.role as "user" | "assistant",
            content: e.content,
            actions: e.actions,
          }));
        if (msgs.length === 0) return;
        setConvos((prev) => ({
          ...prev,
          [m]: [welcomeFor(m), ...msgs],
        }));
      } catch {
        // Historique non critique — on ignore les erreurs.
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const messages = convos[mode];

  const startCouncil = useCallback(() => {
    setConvos((prev) => ({ ...prev, council: [welcomeFor("council")] }));
    setMode("council");
  }, []);

  const send = useCallback(
    async (text?: string) => {
      const content = (text ?? input).trim();
      if (!content || loading) return;
      setInput("");

      const activeMode = mode;
      const history = [
        ...convos[activeMode],
        { role: "user" as const, content },
      ];
      setConvos((prev) => ({ ...prev, [activeMode]: history }));
      setLoading(true);

      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history.map((m) => ({ role: m.role, content: m.content })),
            mode: activeMode,
            now: toLocalIso(new Date()),
          }),
        });
        const data = await res.json();
        setConvos((prev) => ({
          ...prev,
          [activeMode]: [
            ...prev[activeMode],
            {
              role: "assistant",
              content: data.reply || "…",
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
            { role: "assistant", content: "❌ Impossible de contacter l'agent." },
          ],
        }));
      } finally {
        setLoading(false);
      }
    },
    [input, loading, mode, convos, onChanged]
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
              content: `C'est validé — ${
                data.created ?? msg.plan!.sessions.length
              } séance(s) ajoutée(s) à ton agenda.`,
            },
          ],
        }));
        onChanged();
      } catch {
        setConvos((prev) => ({
          ...prev,
          [activeMode]: [
            ...prev[activeMode],
            { role: "assistant", content: "❌ Impossible d'écrire le plan." },
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
    messages,
    suggestions,
    input,
    loading,
    setInput,
    send,
    commitPlan,
  };
}

/** Métadonnées partagées des membres du Conseil + modes de conversation. */

import type { AgentName } from "./types";

/** Mode de conversation actif dans le panneau de chat. Josiane EST l'assistante agenda. */
export type ChatMode = "council" | AgentName;

export type AgentMeta = {
  label: string;
  role: string;
  color: string;
  /** Amorce affichée en tête de conversation. */
  welcome: string;
};

export const AGENT_META: Record<AgentName, AgentMeta> = {
  josiane: {
    label: "Josiane",
    role: "agenda",
    color: "#a855f7",
    welcome:
      "C'est Josiane, je tiens ton agenda. Dis-moi ce que tu veux décaler ou réorganiser et je m'en occupe.",
  },
  emilien: {
    label: "Emilien",
    role: "travail",
    color: "#6366f1",
    welcome:
      "Emilien, ton bras droit côté taf (Delos, Monumia, master, TP). On fait le point sur ta charge de travail ?",
  },
  jannik: {
    label: "Jannik",
    role: "coach sport",
    color: "#f59e0b",
    welcome:
      "Salut, c'est Jannik ! Je connais ta séance du moment — pose-moi tes questions sur les exos, la récup, la technique.",
  },
  djimo: {
    label: "Djimo",
    role: "loisir",
    color: "#06b6d4",
    welcome:
      "Djimo à l'appareil, gardien de ta vie perso. On cale un moment avec Marine ou une sortie ?",
  },
  simone: {
    label: "Simone",
    role: "cuisine",
    color: "#ec4899",
    welcome:
      "Simone aux fourneaux ! Je sais ce qui est prévu au menu. Envie de changer un plat ou d'une idée de recette ?",
  },
};

/** Ordre d'affichage des boutons d'agents. */
export const AGENT_ORDER: AgentName[] = [
  "josiane",
  "emilien",
  "jannik",
  "djimo",
  "simone",
];

export const AGENT_NAMES = AGENT_ORDER;

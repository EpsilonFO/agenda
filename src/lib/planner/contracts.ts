/**
 * Les CONTRATS du planificateur v5 : le LLM ne fait plus que REMPLIR ces JSON,
 * validés par zod. Une sortie invalide déclenche un retry (voir llm.ts) —
 * jamais de parse silencieux.
 *
 * - WeekInput : la demande hebdomadaire STRUCTURÉE (imprévus, sorties datées,
 *   indisponibilités, surcharge sport, exceptions aux quotas). Le greffier du
 *   chat la construit depuis la conversation ; le solveur déterministe fait
 *   tout le reste.
 * - RetouchOp / JosianeRetouchOut : les opérations minimales de retouche d'un
 *   plan en place (par id de session), re-validées par les guardrails.
 */

import { z } from "zod";
import { IsoDateSchema } from "./config";

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "format HH:MM attendu");

/**
 * Catégorie de session, tolérante aux libellés naturels du modèle de retouche :
 * « déjeuner »/« repas » → repas, « cours » → autre, « travail » → monumia.
 */
const SessionCategorySchema = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const n = v
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
  if (["delos", "monumia", "sport", "sortie", "autre", "repas", "trajet"].includes(n))
    return n;
  if (n.includes("trajet") || n.includes("deplacement")) return "trajet";
  if (n.includes("dej") || n.includes("repas") || n.includes("lunch") || n.includes("diner"))
    return "repas";
  if (n.includes("cours") || n.includes("class")) return "autre";
  if (n.includes("travail") || n === "work") return "monumia";
  if (n.includes("loisir") || n.includes("perso") || n.includes("soiree")) return "sortie";
  return n;
  // "trajet" est produit par le solveur (blocs inter-zones) : le contrat doit
  // l'accepter, sinon une retouche portant sur un trajet est rejetée.
}, z.enum(["delos", "monumia", "sport", "sortie", "autre", "repas", "trajet"]));

/* --------------------------- Demande hebdo --------------------------- */

export const WeekInputSchema = z.object({
  /** Lundi de la semaine visée, YYYY-MM-DD. */
  weekStart: IsoDateSchema,
  /** Reste de la demande en texte libre (contexte, humeur, précisions). */
  notes: z.string().default(""),
  /** TP, projets, urgences de la semaine — l'ex-système de deadlines. */
  imprevus: z
    .array(
      z.object({
        label: z.string().min(1),
        hoursNeeded: z.number().positive().optional(),
        deadline: IsoDateSchema.optional(),
        note: z.string().optional(),
      })
    )
    .default([]),
  /** Sorties déjà connues (dîner vendredi, soirée amis samedi…). */
  sortiesDatees: z
    .array(
      z.object({
        label: z.string().min(1),
        withWhom: z.enum(["marine", "amis", "autre"]).default("autre"),
        day: IsoDateSchema.optional(),
        start: HHMM.optional(),
        end: HHMM.optional(),
        note: z.string().optional(),
      })
    )
    .default([]),
  /** Plages où RIEN ne doit être posé (week-end chez les parents, absence…). */
  indisponibilites: z
    .array(
      z.object({
        day: IsoDateSchema,
        from: HHMM.optional(),
        to: HHMM.optional(),
        reason: z.string().optional(),
      })
    )
    .default([]),
  /** Voiture disponible cette semaine. */
  voitureDispo: z.boolean().default(true),
  /**
   * Surcharge hebdo du sport (v5) : par défaut le solveur suit la rotation de
   * la config (perWeek par activité). Ici on peut écarter une activité cette
   * semaine (« pas de natation ») ou en imposer (« 2 courses », escalade —
   * seule voie pour placer une activité « optionnel »). Un activityId inconnu
   * de la config n'est PAS une erreur de schéma : le solveur l'ignore avec un
   * warning (le greffier LLM peut se tromper, ça ne bloque pas la semaine).
   */
  sport: z
    .object({
      exclure: z.array(z.string()).default([]),
      imposer: z
        .array(
          z.object({
            activityId: z.string().min(1),
            fois: z.number().int().min(1).max(4).default(1),
          })
        )
        .default([]),
    })
    .default({ exclure: [], imposer: [] }),
  /**
   * Exceptions ponctuelles aux quotas SOUPLES de la config (ex: Marine absente
   * → sortiesMarineMin 0). Le QUOTA Delos n'est PAS ici : les demi-journées
   * sont une RÈGLE non négociable (le CDD), jamais un volume qu'on ajuste à la
   * semaine — une semaine réellement empêchée passe par les indisponibilités.
   * En revanche le PLACEMENT Delos, lui, se surcharge (regroupement, week-end).
   */
  overrides: z
    .object({
      // Marine peut légitimement tomber à 0 (semaine où elle est absente) —
      // c'est un rappel doux, jamais une obligation vidée.
      sortiesMarineMin: z.number().int().min(0).optional(),
      // Sport et Monumia gardent un plancher : les zéroter était l'hallucination
      // qui vidait la semaine. On peut réduire, pas supprimer.
      sportSessionsMax: z.number().int().min(2).optional(),
      monumiaMinHours: z.number().min(20).optional(),
      // PLACEMENT Delos (le quota reste intouchable) : regrouper ou non les
      // demi-journées sur une même journée ; autoriser le week-end en dernier
      // recours (« semaine impossible autrement »).
      delosGroupHalfDays: z.boolean().optional(),
      delosWeekendOk: z.boolean().optional(),
    })
    .default({}),
});
export type WeekInput = z.infer<typeof WeekInputSchema>;

/* -------------------- Josiane (mode retouche) ------------------------ */

/**
 * Retouche d'un plan déjà en place : Josiane renvoie des OPÉRATIONS minimales
 * ciblant les sessions par ID — jamais un planning complet réécrit.
 */
export const RetouchOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("move"),
    sessionId: z.string().min(1),
    day: IsoDateSchema,
    start: HHMM,
    end: HHMM,
  }),
  z.object({
    op: z.literal("remove"),
    sessionId: z.string().min(1),
  }),
  z.object({
    op: z.literal("add"),
    session: z.object({
      title: z.string().min(1),
      category: SessionCategorySchema,
      activityId: z.string().nullable().default(null),
      placeId: z.string().nullable().default(null),
      day: IsoDateSchema,
      start: HHMM,
      end: HHMM,
      exceptional: z.boolean().default(false),
      rationale: z.string().default(""),
    }),
  }),
]);
export type RetouchOp = z.infer<typeof RetouchOpSchema>;

export const JosianeRetouchOutSchema = z.object({
  operations: z.array(RetouchOpSchema).default([]),
  warnings: z.array(z.string()).default([]),
});
export type JosianeRetouchOut = z.infer<typeof JosianeRetouchOutSchema>;

/**
 * Les CONTRATS du planificateur v2 : tout ce qui entre et sort d'un agent
 * est validé par un schéma zod. Une sortie LLM invalide déclenche un retry
 * (voir llm.ts) — jamais de parse silencieux.
 *
 * - WeekInput : la demande hebdomadaire STRUCTURÉE (imprévus, sorties datées,
 *   indisponibilités, exceptions aux quotas). C'est l'hôte du Conseil qui la
 *   construit depuis la conversation (phase 7).
 * - EmilienOut / JannikOut / DjimoOut : les besoins exprimés par les agents.
 * - JosianeOut : le planning placé (jour + heures), matérialisé ensuite en
 *   PlanSession (phase 4) puis vérifié par les guardrails.
 * - SimoneOut : repas + courses sur la semaine figée.
 */

import { z } from "zod";
import { IsoDateSchema, WeekdaySchema } from "./config";

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "format HH:MM attendu");

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
  /** Exceptions ponctuelles aux quotas de la config (ex: Marine absente → 0). */
  overrides: z
    .object({
      sortiesMarineMin: z.number().int().min(0).optional(),
      sportSessionsMax: z.number().int().min(0).optional(),
      monumiaMinHours: z.number().min(0).optional(),
      delosHalfDays: z.number().int().min(0).optional(),
    })
    .default({}),
});
export type WeekInput = z.infer<typeof WeekInputSchema>;

/* ------------------------- Emilien (travail) ------------------------- */

export const EmilienOutSchema = z.object({
  delos: z.object({
    halfDays: z.number().int().min(0),
    /** Préférence courte de répartition ("plutôt en début de semaine"…). */
    preference: z.string().default(""),
  }),
  monumia: z.object({
    /** Heures visées cette semaine (≥ minimum config, selon la place). */
    targetHours: z.number().min(0),
    note: z.string().default(""),
  }),
  imprevus: z
    .array(
      z.object({
        label: z.string().min(1),
        hours: z.number().positive(),
        deadline: IsoDateSchema.nullable().default(null),
        priority: z.enum(["haute", "normale"]).default("normale"),
      })
    )
    .default([]),
  summary: z.string().default(""),
  messageToJosiane: z.string().default(""),
});
export type EmilienOut = z.infer<typeof EmilienOutSchema>;

/* -------------------------- Jannik (sport) --------------------------- */

export const JannikOutSchema = z.object({
  seances: z
    .array(
      z.object({
        /** id d'une activité de la config — jamais un sport inventé. */
        activityId: z.string().min(1),
        title: z.string().min(1),
        durationMin: z.number().int().positive().optional(),
        preferredDays: z.array(WeekdaySchema).default([]),
        preferredMoment: z
          .enum(["matin", "midi", "apres-midi", "soir", "indifferent"])
          .default("indifferent"),
        exercises: z.array(z.string()).default([]),
        tips: z.array(z.string()).default([]),
      })
    )
    .default([]),
  summary: z.string().default(""),
  messageToJosiane: z.string().default(""),
});
export type JannikOut = z.infer<typeof JannikOutSchema>;

/* -------------------------- Djimo (sorties) -------------------------- */

export const DjimoOutSchema = z.object({
  sorties: z
    .array(
      z.object({
        label: z.string().min(1),
        withWhom: z.enum(["marine", "amis", "autre"]).default("autre"),
        day: IsoDateSchema.nullable().default(null),
        start: HHMM.nullable().default(null),
        durationMin: z.number().int().positive().default(180),
        note: z.string().default(""),
      })
    )
    .default([]),
  summary: z.string().default(""),
  messageToJosiane: z.string().default(""),
});
export type DjimoOut = z.infer<typeof DjimoOutSchema>;

/* ------------------------ Josiane (placement) ------------------------ */

export const JosianeOutSchema = z.object({
  sessions: z
    .array(
      z.object({
        title: z.string().min(1),
        category: z.enum(["delos", "monumia", "sport", "sortie", "autre"]),
        /** id d'activité sportive de la config (sessions sport uniquement). */
        activityId: z.string().nullable().default(null),
        /** id de lieu de la config ; null = lieu libre. */
        placeId: z.string().nullable().default(null),
        day: IsoDateSchema,
        start: HHMM,
        end: HHMM,
        /** true = autorisée à finir après la fin de journée normale. */
        exceptional: z.boolean().default(false),
        rationale: z.string().default(""),
      })
    )
    .default([]),
  warnings: z.array(z.string()).default([]),
  messages: z
    .array(
      z.object({
        to: z.enum(["emilien", "jannik", "djimo"]),
        text: z.string().min(1),
      })
    )
    .default([]),
});
export type JosianeOut = z.infer<typeof JosianeOutSchema>;

/* ------------------------- Simone (cuisine) -------------------------- */

export const SimoneOutSchema = z.object({
  meals: z
    .array(
      z.object({
        day: IsoDateSchema,
        slot: z.enum(["petit-dej", "dejeuner", "diner"]),
        title: z.string().min(1),
        steps: z.array(z.string()).default([]),
        ingredients: z
          .array(z.object({ name: z.string().min(1), qty: z.string().default("") }))
          .default([]),
        rationale: z.string().default(""),
      })
    )
    .default([]),
  groceries: z
    .array(
      z.object({
        name: z.string().min(1),
        qty: z.string().default(""),
        aisle: z.string().default(""),
      })
    )
    .default([]),
  summary: z.string().default(""),
});
export type SimoneOut = z.infer<typeof SimoneOutSchema>;

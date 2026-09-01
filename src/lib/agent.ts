/**
 * Boucle agent du chat — refonte v2 (PLAN.md).
 *
 * Modes :
 *  - "josiane"  : l'assistante agenda (CRUD complet + retouche du plan) ;
 *  - "council"  : l'hôte du Conseil (structure la demande hebdo, lance le
 *    pipeline src/lib/planner/council.ts, plan auto-appliqué) ;
 *  - "emilien" / "jannik" / "djimo" / "simone" : chats individuels, persona
 *    générée depuis la config + contexte déterministe du jour, lecture seule.
 */

import {
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  listMemory,
  addMemory,
} from "./store";
import { MODELS, llmChat, LlmError, chatEffort } from "./llm";
import type { LlmMessage } from "./llm";
import type { ChatMode } from "./agents";
import {
  parseFlexibleDate,
  datesForWeekday,
  formatFullDate,
  upcomingDaysPreview,
  toLocalIso,
  startOfWeek,
} from "./dates";
import { z } from "zod";
import type { AgentResponse, WeekPlan } from "./types";
import { WeekInputSchema, RetouchOpSchema } from "./planner/contracts";
import {
  runCouncilFromStore,
  replanPlanFromStore,
  listPlanSessionsFromStore,
  applyPlanOpsFromStore,
} from "./planner/council";
import { AgentOutputError } from "./planner/llm";
import { buildDayContext } from "./planner/context";
import { loadLifeConfig } from "./planner/config";
import {
  buildDjimoChatSystem,
  buildEmilienChatSystem,
  buildJannikChatSystem,
  buildSimoneChatSystem,
} from "./planner/prompts";
import type { AgentName } from "./types";
import { commitWeekPlan } from "./commit";

/* ----------------------------- Outils ------------------------------ */

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

const tools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "list_events",
      description:
        "Liste tous les événements existants de l'agenda. À appeler avant de planifier pour connaître les créneaux déjà occupés.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "resolve_dates",
      description:
        "Calcule des dates exactes de façon fiable. À utiliser DÈS QUE tu dois connaître une date ou un jour de la semaine (ex: 'les prochains mardis'). Ne calcule JAMAIS les dates toi-même.",
      parameters: {
        type: "object",
        properties: {
          weekday: {
            type: "string",
            description:
              "Jour de la semaine en français (lundi, mardi, …). Optionnel.",
          },
          from: {
            type: "string",
            description:
              "Point de départ : 'today', 'tomorrow', 'next week', ou une date YYYY-MM-DD. Défaut: today.",
          },
          until: {
            type: "string",
            description: "Date de fin incluse (YYYY-MM-DD). Optionnel.",
          },
          count: {
            type: "number",
            description: "Nombre de dates voulues si 'until' absent (défaut 8).",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_event",
      description: "Crée un nouvel événement ponctuel dans l'agenda.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          start: {
            type: "string",
            description: "ISO local sans fuseau, ex: 2026-07-14T09:00:00",
          },
          end: { type: "string", description: "ISO local, ex: 2026-07-14T10:00:00" },
          description: { type: "string" },
          location: { type: "string" },
          category: {
            type: "string",
            description: "travail, sport, perso, santé, famille, loisir…",
          },
          reminderMin: {
            type: "number",
            description:
              "Préavis de rappel en minutes avant le début (ex: 60 = 1h avant, 15 = 15 min avant). Si absent, utilise le défaut global (30 min).",
          },
        },
        required: ["title", "start", "end"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_recurring_event",
      description:
        "Crée un événement récurrent hebdomadaire (ex: un cours tous les mardis). Les dates sont calculées de façon fiable côté serveur — donne juste le jour, les horaires et la période.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          weekday: {
            type: "string",
            description: "Jour en français : lundi, mardi, …",
          },
          startTime: { type: "string", description: "HH:MM, ex: 09:00" },
          endTime: { type: "string", description: "HH:MM, ex: 12:00" },
          from: {
            type: "string",
            description: "Début : 'today' ou YYYY-MM-DD. Défaut: today.",
          },
          until: {
            type: "string",
            description: "Fin incluse : YYYY-MM-DD.",
          },
          location: { type: "string" },
          category: { type: "string" },
        },
        required: ["title", "weekday", "startTime", "endTime", "until"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_event",
      description:
        "Modifie un événement existant. Fournir l'id et uniquement les champs à changer.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          description: { type: "string" },
          location: { type: "string" },
          category: { type: "string" },
          reminderMin: {
            type: "number",
            description:
              "Préavis de rappel en minutes avant le début. Passer 0 pour supprimer un rappel personnalisé et revenir au défaut.",
          },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_reminder",
      description:
        "Définit ou supprime le rappel push d'un événement existant. À utiliser quand l'utilisateur demande d'être notifié X minutes/heures avant un événement précis, ou veut supprimer un rappel.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID de l'événement." },
          reminderMin: {
            type: "number",
            description:
              "Préavis en minutes (ex: 60 = 1h avant, 30 = 30 min avant). Passer 0 pour supprimer le rappel personnalisé et revenir au défaut global.",
          },
        },
        required: ["id", "reminderMin"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_event",
      description: "Supprime un événement de l'agenda via son id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember",
      description:
        "Enregistre une préférence durable de l'utilisateur (ex: 'pas de réunion avant 9h', 'sport le mardi soir'). À utiliser quand il exprime une préférence récurrente.",
      parameters: {
        type: "object",
        properties: { content: { type: "string" } },
        required: ["content"],
      },
    },
  },
];

/* ------------------ Outils du planificateur (mode council) ----------- */

const councilTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "propose_week_plan",
      description:
        "Lance le PLANIFICATEUR DÉTERMINISTE : un solveur place la semaine COMPLÈTE sous contraintes (config de vie) et la PROPOSE (carte avec bouton Valider — rien n'est écrit dans l'agenda avant validation par l'utilisateur). Structure la demande de l'utilisateur dans les champs : ne mets dans notes que ce qui ne rentre nulle part ailleurs.",
      parameters: {
        type: "object",
        properties: {
          weekStart: {
            type: "string",
            description:
              "Semaine visée : 'cette semaine', 'semaine prochaine' ou un lundi YYYY-MM-DD. Défaut : cette semaine.",
          },
          notes: { type: "string", description: "Contexte libre résiduel." },
          imprevus: {
            type: "array",
            description: "TP, projets, urgences de la semaine.",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                hoursNeeded: { type: "number" },
                deadline: { type: "string", description: "YYYY-MM-DD" },
                note: { type: "string" },
              },
              required: ["label"],
            },
          },
          sortiesDatees: {
            type: "array",
            description: "Sorties déjà connues (dîner, soirée…).",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                withWhom: { type: "string", enum: ["marine", "amis", "autre"] },
                zone: {
                  type: "string",
                  description:
                    "Zone de la sortie (id de zone de la config, ex: paris, orsay). ESSENTIELLE pour les trajets. Marine → Orsay et amis → Paris sont déjà connus ; pour « autre », si l'utilisateur ne l'a pas dite et qu'elle n'est pas évidente, DEMANDE-LA avant de lancer.",
                },
                day: { type: "string", description: "YYYY-MM-DD" },
                start: { type: "string", description: "HH:MM" },
                end: { type: "string", description: "HH:MM" },
              },
              required: ["label"],
            },
          },
          indisponibilites: {
            type: "array",
            description:
              "Plages où RIEN ne doit être posé (week-end chez les parents, absence…).",
            items: {
              type: "object",
              properties: {
                day: { type: "string", description: "YYYY-MM-DD" },
                from: { type: "string", description: "HH:MM (défaut: toute la journée)" },
                to: { type: "string", description: "HH:MM" },
                reason: { type: "string" },
              },
              required: ["day"],
            },
          },
          voitureDispo: { type: "boolean", description: "Voiture disponible cette semaine (défaut: oui)." },
          sport: {
            type: "object",
            description:
              "Surcharge sport de la semaine, UNIQUEMENT si l'utilisateur l'a demandée dans ses mots (« pas de natation cette semaine » → exclure ; « je veux 2 footings », « une séance d'escalade » → imposer). Utilise les activityId du système. Sans demande explicite, laisse ABSENT : la rotation normale est déjà connue du solveur.",
            properties: {
              exclure: {
                type: "array",
                items: { type: "string" },
                description: "activityId à ne pas poser cette semaine.",
              },
              imposer: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    activityId: { type: "string" },
                    fois: { type: "number", description: "Nombre de séances (défaut 1)." },
                  },
                  required: ["activityId"],
                },
                description: "Séances explicitement demandées (seule voie pour une activité optionnelle).",
              },
            },
          },
          decisions: {
            type: "object",
            description:
              "Choix QUALITATIFS dits explicitement par l'utilisateur, que le solveur honore s'ils sont faisables (sinon il l'explique) : « Delos mardi et jeudi matin » → delos ; « muscu jeudi soir » → sport ; « le dîner plutôt vendredi » → sorties. UNIQUEMENT ce qu'il a dit — le solveur choisit très bien tout seul le reste.",
            properties: {
              delos: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    date: { type: "string", description: "YYYY-MM-DD" },
                    gabarit: { type: "string", enum: ["journee", "matin", "apres-midi"] },
                  },
                  required: ["date"],
                },
              },
              sport: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    activityId: { type: "string" },
                    date: { type: "string", description: "YYYY-MM-DD" },
                    moment: { type: "string", enum: ["matin", "fin-apres-midi"] },
                  },
                  required: ["activityId", "date"],
                },
              },
              sorties: {
                type: "array",
                description: "Pour donner un jour à une sortie de sortiesDatees qui n'en a pas.",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string", description: "Label EXACT de la sortie." },
                    date: { type: "string", description: "YYYY-MM-DD" },
                    start: { type: "string", description: "HH:MM" },
                  },
                  required: ["label", "date"],
                },
              },
            },
          },
          overrides: {
            type: "object",
            description:
              "⚠️ RÉSERVÉ aux exceptions DEMANDÉES EXPLICITEMENT par l'utilisateur dans SES mots (ex: « Marine est absente cette semaine » → sortiesMarineMin 0 ; « semaine chargée, 2 séances de sport max » → sportSessionsMax 2 ; « semaine légère, pas plus de 20h de Monumia » → monumiaMaxHours 20 ; « pas deux demi-journées Delos le même jour » → delosGroupHalfDays false ; « Delos le week-end ok si besoin » → delosWeekendOk true). Ne DÉDUIS JAMAIS ces valeurs toi-même, ne les remplis pas « pour aider » : les quotas normaux sont déjà connus du solveur. Dans le doute, laisse ABSENT. Le VOLUME Delos est une RÈGLE : aucun override ne le réduit — une semaine empêchée se dit via les indisponibilités.",
            properties: {
              sortiesMarineMin: { type: "number" },
              sportSessionsMax: { type: "number" },
              monumiaMinHours: { type: "number" },
              monumiaMaxHours: { type: "number", description: "Plafond Monumia de la semaine (« semaine légère »), jamais sous le plancher." },
              delosGroupHalfDays: {
                type: "boolean",
                description: "false = ne pas regrouper 2 demi-journées Delos sur une même journée cette semaine.",
              },
              delosWeekendOk: {
                type: "boolean",
                description: "true = Delos toléré le week-end EN DERNIER RECOURS cette semaine.",
              },
            },
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_plan_sessions",
      description:
        "Liste les séances du PLAN d'une semaine avec leur id (ex: sol-7-delos). INDISPENSABLE avant edit_plan_sessions : les événements renvoyés par list_events ne portent pas ces ids. Instantané, aucun coût.",
      parameters: {
        type: "object",
        properties: {
          weekStart: {
            type: "string",
            description:
              "'cette semaine', 'semaine prochaine' ou un lundi YYYY-MM-DD. Défaut : cette semaine.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_plan_sessions",
      description:
        "Applique des modifications PRÉCISES au plan de la semaine, instantanément et sans solveur. À utiliser dès que tu sais DÉJÀ quelle séance toucher ET son créneau exact — c'est le cas normal d'un « déplace X à mardi 14h », « supprime la séance de jeudi », « ajoute 2h de Monumia mercredi 9h ». Récupère les ids via list_plan_sessions d'abord. Les garde-fous sont vérifiés : si la modification casse une règle, elle est refusée et expliquée. N'utilise replan_week QUE si le créneau cible n'est pas déterminable sans chercher (« cale ça où ça rentre », « échange ces deux blocs en respectant les trajets ») — replan_week relance le solveur et propose un NOUVEAU plan à valider.",
      parameters: {
        type: "object",
        properties: {
          weekStart: {
            type: "string",
            description:
              "'cette semaine', 'semaine prochaine' ou un lundi YYYY-MM-DD. Défaut : cette semaine.",
          },
          operations: {
            type: "array",
            description: "Les opérations à appliquer, dans l'ordre.",
            items: {
              type: "object",
              properties: {
                op: {
                  type: "string",
                  enum: ["move", "remove", "add"],
                },
                sessionId: {
                  type: "string",
                  description: "Id de la séance visée (move et remove).",
                },
                day: { type: "string", description: "YYYY-MM-DD (move et add)." },
                start: { type: "string", description: "HH:MM (move et add)." },
                end: { type: "string", description: "HH:MM (move et add)." },
                session: {
                  type: "object",
                  description: "Séance à créer (op = add uniquement).",
                  properties: {
                    title: { type: "string" },
                    category: {
                      type: "string",
                      description: "delos, monumia, sport, sortie, repas, trajet, autre…",
                    },
                    activityId: { type: "string" },
                    placeId: { type: "string" },
                    day: { type: "string", description: "YYYY-MM-DD" },
                    start: { type: "string", description: "HH:MM" },
                    end: { type: "string", description: "HH:MM" },
                    rationale: { type: "string" },
                  },
                  required: ["title", "category", "day", "start", "end"],
                },
              },
              required: ["op"],
            },
          },
        },
        required: ["operations"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "replan_week",
      description:
        "REPLANIFICATION PAR LE SOLVEUR : la consigne est traduite en modification de la demande de la semaine (« muscu jeudi soir », « Delos mardi », « ajoute un dîner vendredi ») puis TOUTE la semaine est re-résolue — déjeuner, Monumia et trajets recalés. Résultat : un nouveau plan PROPOSÉ (carte à valider), rien n'est écrit avant validation. Si tu connais déjà la séance ET son créneau exact, utilise edit_plan_sessions (instantané, appliqué directement).",
      parameters: {
        type: "object",
        properties: {
          changeNote: { type: "string", description: "La modification demandée, telle quelle." },
          weekStart: {
            type: "string",
            description: "Semaine du plan : 'cette semaine', 'semaine prochaine' ou lundi YYYY-MM-DD.",
          },
        },
        required: ["changeNote"],
      },
    },
  },
];

/** Opérations de retouche reçues d'un appel d'outil (validées avant application). */
const RetouchOpsSchema = z.array(RetouchOpSchema);

/** Résout 'cette semaine'/'semaine prochaine'/date en lundi YYYY-MM-DD. */
function resolveWeekStart(raw?: unknown): string {
  return toLocalIso(startOfWeek(parseFlexibleDate(raw ? String(raw) : undefined))).slice(0, 10);
}

/** Construit un WeekInput validé depuis les arguments d'outil (tolérant). */
export function toWeekInput(args: Record<string, unknown>): ReturnType<typeof WeekInputSchema.parse> {
  const weekStart = resolveWeekStart(args.weekStart);
  const parsed = WeekInputSchema.safeParse({ ...args, weekStart });
  if (parsed.success) return parsed.data;

  // Cause la plus fréquente d'échec : un `overrides` hors-bornes. Le schéma
  // borne volontairement les quotas souples (pas de 0 « pour aider » ; Delos
  // n'y est même plus — c'est une RÈGLE). Plutôt que de tout jeter en texte
  // libre, on retente SANS les overrides : le reste de la demande structurée
  // (imprévus, sorties, indispos) doit survivre à un override fautif.
  const { overrides, ...rest } = args;
  const retry = WeekInputSchema.safeParse({ ...rest, weekStart });
  if (retry.success) {
    console.warn(`[agent] overrides rejetés (hors-bornes, ignorés) : ${JSON.stringify(overrides)}`);
    return retry.data;
  }

  // Même filet pour une surcharge sport mal formée : le reste survit.
  const { sport, ...restSansSport } = rest;
  const retrySansSport = WeekInputSchema.safeParse({ ...restSansSport, weekStart });
  if (retrySansSport.success) {
    console.warn(`[agent] surcharge sport rejetée (mal formée, ignorée) : ${JSON.stringify(sport)}`);
    return retrySansSport.data;
  }

  // Dernier recours : structure inexploitable → tout en texte libre.
  return WeekInputSchema.parse({
    weekStart,
    notes: `${args.notes || ""}\n(Demande brute : ${JSON.stringify(args)})`.trim(),
  });
}

const CATEGORY_COLORS: Record<string, string> = {
  travail: "#6366f1",
  perso: "#10b981",
  sport: "#f59e0b",
  santé: "#ef4444",
  sante: "#ef4444",
  famille: "#ec4899",
  loisir: "#06b6d4",
  trajet: "#f97316",
};

function colorFor(category?: string): string {
  if (!category) return "#6366f1";
  return CATEGORY_COLORS[category.toLowerCase()] || "#6366f1";
}

/* ------------------------ Exécution d'un outil ---------------------- */

type ToolContext = {
  actions: string[];
  plan?: WeekPlan;
  /** Le Conseil complet a déjà tourné ce tour-ci — coupe les relances à l'identique. */
  councilInvoked?: boolean;
};

async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<{ result: unknown; changed: boolean }> {
  switch (name) {
    case "list_events": {
      const events = await listEvents();
      return { result: events, changed: false };
    }
    case "resolve_dates": {
      const from = parseFlexibleDate(
        args.from ? String(args.from) : undefined
      );
      const until = args.until ? parseFlexibleDate(String(args.until)) : undefined;
      const count = args.count ? Number(args.count) : 8;
      const weekday = args.weekday ? String(args.weekday) : undefined;
      const dates = weekday
        ? datesForWeekday(weekday, from, until, count)
        : // Sans jour précis : les `count` prochains jours depuis `from`.
          Array.from({ length: until ? 0 : count }, (_, i) => {
            const d = new Date(from);
            d.setDate(d.getDate() + i);
            return d;
          });
      return {
        result: {
          dates: dates.map((d) => ({
            date: toLocalIso(d).slice(0, 10),
            label: formatFullDate(d),
          })),
        },
        changed: false,
      };
    }
    case "create_event": {
      const ev = await createEvent({
        title: String(args.title),
        start: String(args.start),
        end: String(args.end),
        description: args.description ? String(args.description) : undefined,
        location: args.location ? String(args.location) : undefined,
        category: args.category ? String(args.category) : undefined,
        color: colorFor(args.category ? String(args.category) : undefined),
        reminderMin: args.reminderMin != null ? Number(args.reminderMin) : undefined,
      });
      ctx.actions.push(
        `Ajouté : « ${ev.title} »${ev.reminderMin != null ? ` (rappel ${ev.reminderMin} min avant)` : ""}`
      );
      return { result: ev, changed: true };
    }
    case "create_recurring_event": {
      const from = parseFlexibleDate(args.from ? String(args.from) : undefined);
      const until = args.until ? parseFlexibleDate(String(args.until)) : undefined;
      const dates = datesForWeekday(String(args.weekday), from, until);
      const [sh, sm] = String(args.startTime).split(":").map(Number);
      const [eh, em] = String(args.endTime).split(":").map(Number);
      const category = args.category ? String(args.category) : undefined;
      const created: string[] = [];
      for (const d of dates) {
        const start = new Date(d);
        start.setHours(sh || 0, sm || 0, 0, 0);
        const end = new Date(d);
        end.setHours(eh || 0, em || 0, 0, 0);
        const ev = await createEvent({
          title: String(args.title),
          start: toLocalIso(start),
          end: toLocalIso(end),
          location: args.location ? String(args.location) : undefined,
          category,
          color: colorFor(category),
        });
        created.push(ev.start);
      }
      ctx.actions.push(
        `Ajouté « ${String(args.title)} » sur ${created.length} ${String(
          args.weekday
        )}s`
      );
      return {
        result: { count: created.length, dates: created },
        changed: created.length > 0,
      };
    }
    case "update_event": {
      const { id, ...rest } = args as { id: string } & Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined && v !== null && v !== "") patch[k] = v;
      }
      if (patch.category) patch.color = colorFor(String(patch.category));
      // reminderMin peut être 0 (suppression du rappel perso) — on le passe explicitement.
      if (args.reminderMin != null) patch.reminderMin = Number(args.reminderMin) || undefined;
      const ev = await updateEvent(String(id), patch);
      if (!ev) return { result: { error: "événement introuvable" }, changed: false };
      ctx.actions.push(`Modifié : « ${ev.title} »`);
      return { result: ev, changed: true };
    }
    case "set_reminder": {
      const evId = String(args.id);
      const minutes = Number(args.reminderMin);
      // 0 = supprimer le rappel personnalisé (retour au défaut global).
      const patch = { reminderMin: minutes > 0 ? minutes : undefined };
      const ev = await updateEvent(evId, patch);
      if (!ev) return { result: { error: "événement introuvable" }, changed: false };
      const msg =
        minutes > 0
          ? `Rappel de ${minutes} min défini pour « ${ev.title} »`
          : `Rappel personnalisé supprimé pour « ${ev.title} » (retour au défaut)`;
      ctx.actions.push(msg);
      return { result: { id: ev.id, title: ev.title, reminderMin: ev.reminderMin }, changed: true };
    }
    case "delete_event": {
      const ok = await deleteEvent(String(args.id));
      if (ok) ctx.actions.push("Supprimé un événement");
      return { result: { deleted: ok }, changed: ok };
    }
    case "remember": {
      const item = await addMemory(String(args.content));
      ctx.actions.push(`Mémorisé : « ${item.content} »`);
      return { result: item, changed: false };
    }
    case "propose_week_plan": {
      // Garde-fou : le solveur est déterministe — le relancer à l'identique
      // dans le même tour redonne EXACTEMENT le même plan. Une fois qu'il a
      // tourné, on refuse toute relance et on renvoie le greffier vers le
      // plan déjà produit (c'est à l'utilisateur de préciser sa demande).
      if (ctx.councilInvoked) {
        return {
          result: {
            weekStart: ctx.plan?.weekStart,
            blockingErrors: ctx.plan?.blockingErrors,
            note: "Le planificateur a DÉJÀ tourné ce tour-ci (la carte est affichée). NE rappelle PAS propose_week_plan : le solveur est déterministe, relancer à l'identique redonne exactement le même plan. Présente le plan précédent à l'utilisateur et ARRÊTE-TOI — c'est à lui de trancher.",
          },
          changed: false,
        };
      }
      ctx.councilInvoked = true;
      const input = toWeekInput(args);
      const plan = await runCouncilFromStore(input);
      ctx.plan = plan;

      // Un plan qui viole encore des règles n'est JAMAIS appliqué tout seul :
      // il est proposé (carte + bouton Valider), l'utilisateur tranche.
      if (plan.blockingErrors?.length) {
        ctx.actions.push(
          `Plan proposé pour la semaine du ${input.weekStart} — NON appliqué (${plan.blockingErrors.length} règle(s) encore violée(s))`
        );
        return {
          result: {
            weekStart: plan.weekStart,
            sessionsCount: plan.sessions.length,
            blockingErrors: plan.blockingErrors,
            summary: plan.summary,
            note: "PLAN NON APPLIQUÉ : le solveur n'a pas réussi à respecter toutes les règles (semaine trop contrainte). La carte est déjà affichée. NE rappelle PAS propose_week_plan — le solveur est déterministe, relancer à l'identique redonnerait le même plan. Explique en langage naturel ce qui coince (liste blockingErrors) puis ARRÊTE-TOI : c'est à l'utilisateur de trancher — soit il te redonne des précisions pour un prochain essai, soit il valide quand même ce plan imparfait via le bouton de la carte.",
          },
          changed: false,
        };
      }

      // v5.1 : plus d'auto-application. Le plan est PROPOSÉ (carte + bouton
      // Valider) — c'est l'utilisateur qui l'écrit dans l'agenda, après avoir
      // regardé le rendu. La validation passe par /api/plan/commit.
      ctx.actions.push(
        `Plan proposé pour la semaine du ${input.weekStart} : ${plan.sessions.length} sessions (à valider)`
      );
      return {
        result: {
          weekStart: plan.weekStart,
          sessionsCount: plan.sessions.length,
          warnings: plan.warnings,
          summary: plan.summary,
          note: "PLAN PROPOSÉ, pas encore dans l'agenda : la carte affichée porte un bouton Valider. NE rappelle PAS propose_week_plan (déterministe : même demande = même plan). Résume en une phrase les choix du solveur à partir de summary (volume Monumia, jours Delos, trajets), relaie les warnings s'il y en a, puis invite à valider ou à dire ce qu'il faut changer.",
        },
        changed: false,
      };
    }
    case "list_plan_sessions": {
      const weekStart = resolveWeekStart(args.weekStart);
      const found = await listPlanSessionsFromStore(weekStart);
      if (!found) {
        return {
          result: { error: `Aucun plan en place pour la semaine du ${weekStart}.` },
          changed: false,
        };
      }
      return {
        result: {
          weekStart,
          sessions: found.sessions.map((s) => ({
            id: s.id,
            title: s.title,
            category: s.category,
            start: s.start,
            end: s.end,
            placeId: s.placeId,
          })),
        },
        changed: false,
      };
    }
    case "edit_plan_sessions": {
      const weekStart = resolveWeekStart(args.weekStart);
      const parsed = RetouchOpsSchema.safeParse(args.operations);
      if (!parsed.success) {
        return {
          result: {
            error:
              "Opérations mal formées — corrige et relance : " +
              parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join(" ; "),
          },
          changed: false,
        };
      }
      const plan = await applyPlanOpsFromStore(weekStart, parsed.data);
      if (!plan) {
        return {
          result: {
            error: `Aucun plan en place pour la semaine du ${weekStart}. Sans plan, modifie les événements avec update_event.`,
          },
          changed: false,
        };
      }
      // Une modification qui casse une règle n'est jamais appliquée en silence.
      if (plan.blockingErrors?.length) {
        ctx.plan = plan;
        return {
          result: {
            weekStart,
            blockingErrors: plan.blockingErrors,
            note: "NON APPLIQUÉ : ces opérations introduisent les violations listées. Explique le problème à l'utilisateur et propose un autre créneau, ou laisse-le valider quand même via la carte.",
          },
          changed: false,
        };
      }
      await commitWeekPlan(plan);
      plan.committed = true;
      ctx.plan = plan;
      ctx.actions.push(
        `Plan de la semaine du ${weekStart} modifié (${parsed.data.length} opération(s))`
      );
      return {
        result: {
          weekStart,
          sessionsCount: plan.sessions.length,
          warnings: plan.warnings,
          note: "Modification appliquée à l'agenda. Confirme brièvement et relaie les warnings s'il y en a.",
        },
        changed: true,
      };
    }
    case "replan_week": {
      const weekStart = resolveWeekStart(args.weekStart);
      const plan = await replanPlanFromStore(weekStart, String(args.changeNote || ""));
      if (!plan) {
        return {
          result: {
            error: `Aucun plan validé pour la semaine du ${weekStart}. Utilise propose_week_plan d'abord (puis valide-le).`,
          },
          changed: false,
        };
      }
      ctx.plan = plan;
      if (plan.blockingErrors?.length) {
        return {
          result: {
            weekStart,
            blockingErrors: plan.blockingErrors,
            summary: plan.summary,
            note: "REPLANIFICATION NON APPLIQUÉE : le nouveau plan viole encore ces règles. Explique le problème à l'utilisateur et propose une alternative, ou qu'il valide quand même via la carte.",
          },
          changed: false,
        };
      }
      ctx.actions.push(`Nouveau plan proposé pour la semaine du ${weekStart} (à valider)`);
      return {
        result: {
          weekStart,
          sessionsCount: plan.sessions.length,
          warnings: plan.warnings,
          summary: plan.summary,
          note: "NOUVEAU PLAN PROPOSÉ (toute la semaine re-résolue avec la modification) : la carte porte un bouton Valider, rien n'est encore écrit. Résume ce qui a changé, relaie les warnings (dont « Non traduit : … » = ce que la consigne n'a pas pu exprimer), invite à valider.",
        },
        changed: false,
      };
    }
    default:
      return { result: { error: `outil inconnu: ${name}` }, changed: false };
  }
}

/* --------------------------- Boucle agent --------------------------- */

type IncomingMessage = { role: "user" | "assistant"; content: string };

const JOSIANE_SYSTEM = (today: Date, memoryBlock: string) =>
  `Tu es Josiane, la cheffe d'orchestre de l'agenda personnel de l'utilisateur. Organisée, diplomate mais ferme. Pour l'instant, tu t'occupes UNIQUEMENT de gérer des éléments de l'agenda : créer, déplacer, modifier ou supprimer des événements ponctuels ou récurrents.

Aujourd'hui : ${formatFullDate(today)}.

Prochains jours (pour te repérer — NE calcule jamais de dates toi-même) :
${upcomingDaysPreview(today, 14)}

Règles :
- Pour TOUTE date ou jour de semaine, appelle resolve_dates. Ne devine jamais une date.
- Pour un événement qui se répète (ex: "tous les mardis"), utilise create_recurring_event.
- Utilise list_events avant de modifier pour éviter les chevauchements.
- Les dates que tu produis sont au format ISO local sans fuseau (ex: 2026-07-14T09:00:00).
- Quand l'utilisateur exprime une préférence récurrente, appelle remember.
- Une séance posée par le Conseil ne se modifie JAMAIS avec update_event : le plan stocké resterait périmé et ta modification serait écrasée au prochain passage. Passe par le plan.
- Cible connue (tu sais quelle séance et à quel créneau) → list_plan_sessions puis edit_plan_sessions. C'est instantané, et c'est le cas de la grande majorité des demandes.
- Cible à chercher seulement (« cale ça où ça rentre », « échange ces blocs en respectant les trajets », « muscu plutôt jeudi soir ») → replan_week. Il traduit la consigne et relance le solveur sur toute la semaine : le nouveau plan est PROPOSÉ (carte à valider), pas écrit.
- Pour REPLANIFIER toute la semaine, invite l'utilisateur à ouvrir une séance du Conseil.
- Réponds en français, de façon concise et chaleureuse.

Préférences enregistrées de l'utilisateur :
${memoryBlock}`;

/** Le greffier du planificateur : structure la demande puis lance le solveur. */
const COUNCIL_HOST_SYSTEM = (today: Date, memoryBlock: string, sportList: string, zoneList: string) =>
  `Tu es le GREFFIER du planificateur de semaine. Ton unique rôle : STRUCTURER la demande de l'utilisateur en JSON, puis lancer le solveur déterministe qui place et optimise la semaine sous contraintes (les règles de vie sont sa config, il les connaît toutes). Tu ne décides RIEN : tu retranscris ce que l'utilisateur a dit, tu n'inventes AUCUNE valeur. Le plan produit est PROPOSÉ à l'utilisateur (carte avec bouton Valider) : rien n'est écrit dans l'agenda avant qu'il valide.

Aujourd'hui : ${formatFullDate(today)}.

Prochains jours (NE calcule jamais de dates toi-même, utilise resolve_dates au besoin) :
${upcomingDaysPreview(today, 14)}

ACTIVITÉS SPORTIVES du système (les seuls activityId valides) :
${sportList}

ZONES du système (les seuls ids de zone valides) : ${zoneList}

- Dès que tu as de quoi travailler, appelle propose_week_plan en remplissant les champs structurés (imprévus/TP avec échéances, sorties datées, indisponibilités comme « chez les parents », voiture, surcharge sport). Le champ notes ne reçoit que le résiduel.
- Sorties : withWhom = "marine" pour Marine, "amis" pour des amis (sortie entre amis = Paris par défaut), "autre" sinon. La ZONE (champ zone) est ESSENTIELLE pour les trajets : remplis-la quand elle est dite ou évidente ; pour une sortie « autre » sans zone connue, pose LA question (« c'est à Paris ou à Orsay ? ») avant de lancer.
- Choix explicites (« Delos mardi et jeudi », « muscu jeudi soir », « le dîner plutôt vendredi ») → champ decisions. Le solveur les honore s'ils sont faisables et explique sinon. Ne remplis JAMAIS decisions de toi-même : sans consigne, le solveur choisit.
- Le champ sport (exclure/imposer) et le champ overrides sont INTERDITS sauf demande explicite de l'utilisateur cette semaine (« pas de natation » → sport.exclure ; « Marine est absente » → sortiesMarineMin 0 ; « pas deux demi-journées Delos le même jour » → delosGroupHalfDays false ; « Delos le week-end si besoin » → delosWeekendOk true). Les quotas et la rotation normaux sont déjà dans la config du solveur : ne les répète pas, ne les ajuste pas, n'aide pas. Le VOLUME Delos est une RÈGLE, aucun override ne le réduit : une semaine empêchée se dit via les indisponibilités.
- Pour une petite modification d'un plan déjà en place (« décale ma muscu à jeudi »), appelle replan_week.
- S'il manque une info ESSENTIELLE (quelle semaine ?), pose UNE question courte. Sinon lance-toi : inutile de redemander les règles de vie, le solveur les connaît.
- Réponds en français, chaleureux et bref. Après un plan : NE réénumère pas les sessions (la carte s'affiche) ; en une phrase, dis les choix du solveur (summary : volume Monumia, jours Delos, trajets), relaie les warnings éventuels, puis invite à valider (bouton de la carte) ou à dire ce qu'il faut changer.

Préférences enregistrées de l'utilisateur :
${memoryBlock}`;

/** Noms d'outils autorisés par mode. */
const CRUD_TOOL_NAMES = [
  "list_events",
  "resolve_dates",
  "create_event",
  "create_recurring_event",
  "update_event",
  "set_reminder",
  "delete_event",
  "remember",
];
/** Les agents individuels lisent et mémorisent — seule Josiane modifie l'agenda. */
const READONLY_TOOL_NAMES = ["list_events", "resolve_dates", "remember"];
/** Retouche déterministe du plan : réservée à Josiane (l'hôte du Conseil délègue au solveur). */
const PLAN_EDIT_TOOL_NAMES = ["list_plan_sessions", "edit_plan_sessions"];

const CHAT_SYSTEM_BUILDERS: Record<
  Exclude<AgentName, "josiane">,
  (cfg: Awaited<ReturnType<typeof loadLifeConfig>>) => string
> = {
  jannik: buildJannikChatSystem,
  emilien: buildEmilienChatSystem,
  djimo: buildDjimoChatSystem,
  simone: buildSimoneChatSystem,
};

export async function runAgent(
  history: IncomingMessage[],
  opts?: { mode?: ChatMode; now?: string; conversationContext?: string }
): Promise<AgentResponse> {
  const mode: ChatMode = opts?.mode || "josiane";
  const isCouncil = mode === "council";
  const isJosiane = mode === "josiane";

  const memory = await listMemory();
  const memoryBlock =
    memory.length > 0
      ? memory.map((m) => `- ${m.content}`).join("\n")
      : "(aucune préférence enregistrée pour l'instant)";

  const today = opts?.now && !Number.isNaN(Date.parse(opts.now))
    ? new Date(opts.now)
    : new Date();

  let base: string;
  let modeTools: ToolDef[];
  if (isCouncil) {
    const cfg = await loadLifeConfig();
    const sportList = cfg.sport.activities
      .map((a) => `- ${a.id} — ${a.name}${a.status === "optionnel" ? " (optionnel : seulement sur demande)" : ""}`)
      .join("\n");
    const zoneList = cfg.clusters.map((c) => `${c.id} (${c.name})`).join(", ");
    base = COUNCIL_HOST_SYSTEM(today, memoryBlock, sportList, zoneList);
    modeTools = [
      ...councilTools.filter((t) => !PLAN_EDIT_TOOL_NAMES.includes(t.function.name)),
      ...tools.filter((t) => ["list_events", "resolve_dates"].includes(t.function.name)),
    ];
  } else if (isJosiane) {
    // Josiane : CRUD complet + retouche du plan, avec le contexte du jour.
    const context = await buildDayContext("josiane", opts?.now);
    base = `${JOSIANE_SYSTEM(today, memoryBlock)}\n\n${context}`;
    modeTools = [
      ...tools.filter((t) => CRUD_TOOL_NAMES.includes(t.function.name)),
      ...councilTools.filter(
        (t) =>
          t.function.name === "replan_week" ||
          PLAN_EDIT_TOOL_NAMES.includes(t.function.name)
      ),
    ];
  } else {
    // Agent individuel : persona générée depuis la config + contexte du jour.
    const [cfg, context] = await Promise.all([
      loadLifeConfig(),
      buildDayContext(mode, opts?.now),
    ]);
    base = `${CHAT_SYSTEM_BUILDERS[mode](cfg)}

Aujourd'hui : ${formatFullDate(today)}.

${context}

Préférences enregistrées de l'utilisateur :
${memoryBlock}`;
    modeTools = tools.filter((t) => READONLY_TOOL_NAMES.includes(t.function.name));
  }

  const system: LlmMessage = {
    role: "system",
    content: opts?.conversationContext ? base + opts.conversationContext : base,
  };

  const messages: LlmMessage[] = [
    system,
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const ctx: ToolContext = { actions: [] };
  let changed = false;
  const MAX_TURNS = 6;
  // Durée totale : c'est elle que ressent l'utilisateur, pas celle d'un appel.
  // Chaque tour de boucle est un aller-retour LLM complet, et un outil comme
  // replan_week en déclenche 1 à 2 de plus à l'intérieur.
  const tStart = Date.now();

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const message = await llmChat({
        model: MODELS.small,
        messages,
        tools: modeTools,
        toolChoice: "auto",
        label: `chat:${mode}`,
        effort: chatEffort(),
      });

      messages.push(message);

      const toolCalls = message.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        console.log(
          `[agent:${mode}] terminé en ${Math.round((Date.now() - tStart) / 1000)}s (${turn + 1} tour(s))`
        );
        return {
          reply: message.content || "C'est fait !",
          actions: ctx.actions,
          changed,
          plan: ctx.plan,
        };
      }

      for (const call of toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          args = {};
        }
        const tTool = Date.now();
        const { result, changed: c } = await runTool(
          call.function.name,
          args,
          ctx
        );
        console.log(
          `[agent:${mode}] outil ${call.function.name} en ${Math.round((Date.now() - tTool) / 1000)}s`
        );
        if (c) changed = true;
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify(result),
        });
      }
    }
  } catch (err) {
    console.error("[agent] échec :", err);
    // Clé absente / provider mal configuré : le message porte déjà le nom de
    // la variable d'environnement à renseigner, quel que soit le fournisseur.
    if (err instanceof LlmError && (err.kind === "no-key" || err.kind === "config")) {
      return {
        reply: `⚠️ ${err.message} Puis relance le serveur.`,
        actions: ctx.actions,
        changed,
      };
    }
    let reply: string;
    if (err instanceof AgentOutputError) {
      reply = `❌ ${err.agent} n'a pas réussi à produire une réponse exploitable après ${err.attempts} tentatives. Réessaie — si ça persiste, son modèle est peut-être en difficulté.\nDétail : ${err.lastIssues.slice(0, 300)}`;
    } else if (err instanceof LlmError) {
      reply = `❌ Erreur de l'API ${err.provider || "LLM"}${err.status ? ` (${err.status})` : ""} : ${err.message.slice(0, 300)}`;
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      reply = `❌ Erreur interne : ${msg.slice(0, 300)}`;
    }
    return {
      reply,
      actions: ctx.actions,
      changed,
      plan: ctx.plan,
    };
  }

  return {
    reply:
      "J'ai atteint la limite d'étapes. Voici ce que j'ai pu faire — reformule si besoin.",
    actions: ctx.actions,
    changed,
    plan: ctx.plan,
  };
}

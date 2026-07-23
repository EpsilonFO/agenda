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
import { MODELS, openaiChat, OpenAIError } from "./openai";
import type { ChatMode } from "./agents";
import {
  parseFlexibleDate,
  datesForWeekday,
  formatFullDate,
  upcomingDaysPreview,
  toLocalIso,
  startOfWeek,
} from "./dates";
import type { AgentResponse, WeekPlan } from "./types";
import { WeekInputSchema } from "./planner/contracts";
import { runCouncilFromStore, retouchPlanFromStore } from "./planner/council";
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
  type: string;
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

/* --------------------- Outils du Conseil (mode council) -------------- */

const councilTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "propose_week_plan",
      description:
        "Réunit LE CONSEIL (Emilien=travail, Jannik=sport, Djimo=sorties, Josiane=agenda, Simone=cuisine) pour planifier la semaine COMPLÈTE et l'APPLIQUER directement à l'agenda. Structure la demande de l'utilisateur dans les champs : ne mets dans notes que ce qui ne rentre nulle part ailleurs.",
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
          overrides: {
            type: "object",
            description:
              "⚠️ RÉSERVÉ aux exceptions DEMANDÉES EXPLICITEMENT par l'utilisateur dans SES mots (ex: « Marine est absente cette semaine » → sortiesMarineMin 0 ; « semaine chargée, 2 séances de sport max » → sportSessionsMax 2). Ne DÉDUIS JAMAIS ces valeurs toi-même, ne les remplis pas « pour aider » : les quotas normaux sont déjà connus du Conseil. Dans le doute, laisse ABSENT. Delos (3 demi-journées) est une RÈGLE : jamais ici — une semaine empêchée se dit via les indisponibilités.",
            properties: {
              sortiesMarineMin: { type: "number" },
              sportSessionsMax: { type: "number" },
              monumiaMinHours: { type: "number" },
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
      name: "replan_week",
      description:
        "RETOUCHE CIBLÉE du plan déjà appliqué : une modification ponctuelle (déplacer/annuler/ajouter une session), tout le reste est conservé. Pour refaire toute la semaine, utilise propose_week_plan.",
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
      // Garde-fou : le Conseil est TRÈS coûteux (émetteurs + Josiane et sa
      // boucle de réparation, plusieurs minutes). Le relancer à l'identique
      // dans le même tour redonne un plan tout aussi imparfait pour rien —
      // c'est exactement la boucle observée quand un plan reste imparfait.
      // Une fois qu'il a tourné, on refuse toute relance et on renvoie l'hôte
      // vers le plan déjà produit.
      if (ctx.councilInvoked) {
        return {
          result: {
            weekStart: ctx.plan?.weekStart,
            blockingErrors: ctx.plan?.blockingErrors,
            note: "Le Conseil a DÉJÀ délibéré ce tour-ci (la carte est affichée). NE rappelle PAS propose_week_plan : relancer à l'identique redonne le même résultat et coûte plusieurs minutes. Présente le plan précédent à l'utilisateur et ARRÊTE-TOI — c'est à lui de trancher.",
          },
          changed: false,
        };
      }
      ctx.councilInvoked = true;
      const input = toWeekInput(args);
      const plan = await runCouncilFromStore(input);

      // Un plan qui viole encore des règles n'est JAMAIS appliqué tout seul :
      // il est proposé (carte + bouton Valider), l'utilisateur tranche.
      if (plan.blockingErrors?.length) {
        ctx.plan = plan;
        ctx.actions.push(
          `Plan proposé pour la semaine du ${input.weekStart} — NON appliqué (${plan.blockingErrors.length} règle(s) encore violée(s))`
        );
        return {
          result: {
            weekStart: plan.weekStart,
            sessionsCount: plan.sessions.length,
            blockingErrors: plan.blockingErrors,
            note: "PLAN NON APPLIQUÉ : le Conseil n'a pas réussi à respecter toutes les règles, même après réparation. La carte est déjà affichée. NE rappelle PAS propose_week_plan — relancer à l'identique redonnera le même plan imparfait et coûte plusieurs minutes. Explique en langage naturel ce qui coince (liste blockingErrors) puis ARRÊTE-TOI : c'est à l'utilisateur de trancher — soit il te redonne des précisions pour un prochain essai, soit il valide quand même ce plan imparfait via le bouton de la carte.",
          },
          changed: false,
        };
      }

      await commitWeekPlan(plan);
      plan.committed = true;
      ctx.plan = plan;
      ctx.actions.push(
        `Semaine du ${input.weekStart} planifiée : ${plan.sessions.length} sessions${plan.meals?.length ? `, ${plan.meals.length} repas` : ""}`
      );
      return {
        result: {
          weekStart: plan.weekStart,
          sessionsCount: plan.sessions.length,
          mealsCount: plan.meals?.length || 0,
          warnings: plan.warnings,
          note: "Le Conseil a délibéré et APPLIQUÉ le plan (déjà dans l'agenda, carte affichée). Confirme brièvement, relaie les warnings s'il y en a, propose d'ajuster.",
        },
        changed: true,
      };
    }
    case "replan_week": {
      const weekStart = resolveWeekStart(args.weekStart);
      const plan = await retouchPlanFromStore(weekStart, String(args.changeNote || ""));
      if (!plan) {
        return {
          result: {
            error: `Aucun plan en place pour la semaine du ${weekStart}. Utilise propose_week_plan d'abord.`,
          },
          changed: false,
        };
      }
      if (plan.blockingErrors?.length) {
        ctx.plan = plan;
        return {
          result: {
            weekStart,
            blockingErrors: plan.blockingErrors,
            note: "RETOUCHE NON APPLIQUÉE : elle introduirait ces violations. Explique le problème à l'utilisateur et propose une alternative (autre créneau) ou qu'il valide quand même via la carte.",
          },
          changed: false,
        };
      }
      await commitWeekPlan(plan);
      plan.committed = true;
      ctx.plan = plan;
      ctx.actions.push(`Plan de la semaine du ${weekStart} retouché`);
      return {
        result: {
          weekStart,
          sessionsCount: plan.sessions.length,
          warnings: plan.warnings,
          note: "Retouche appliquée à l'agenda. Confirme brièvement et relaie les warnings s'il y en a.",
        },
        changed: true,
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
- Pour une RETOUCHE du plan de semaine en place (déplacer/annuler/ajouter une session posée par le Conseil), utilise replan_week — ne bricole pas les événements du plan un par un.
- Pour REPLANIFIER toute la semaine, invite l'utilisateur à ouvrir une séance du Conseil.
- Réponds en français, de façon concise et chaleureuse.

Préférences enregistrées de l'utilisateur :
${memoryBlock}`;

/** L'hôte du Conseil : recueille la semaine puis appelle les outils structurés. */
const COUNCIL_HOST_SYSTEM = (today: Date, memoryBlock: string) =>
  `Tu es l'hôte du CONSEIL, qui réunit Emilien (travail), Jannik (sport), Djimo (sorties), Josiane (agenda) et Simone (cuisine) pour organiser la semaine de l'utilisateur.

Aujourd'hui : ${formatFullDate(today)}.

Prochains jours (NE calcule jamais de dates toi-même, utilise resolve_dates au besoin) :
${upcomingDaysPreview(today, 14)}

Ton rôle : STRUCTURER la demande de l'utilisateur puis lancer le Conseil. Tu es un GREFFIER, pas un décideur : tu retranscris ce que l'utilisateur a dit, tu n'inventes AUCUNE valeur.
- Dès que tu as de quoi travailler, appelle propose_week_plan en remplissant les champs structurés (imprévus/TP avec échéances, sorties datées, indisponibilités comme « chez les parents », voiture). Le champ notes ne reçoit que le résiduel.
- Le champ overrides est INTERDIT sauf demande explicite de l'utilisateur cette semaine (« Marine est absente » → sortiesMarineMin 0 ; « semaine chargée, moins de sport »). Les quotas normaux sont déjà connus du Conseil : ne les répète pas, ne les ajuste pas, n'aide pas. Les 3 demi-journées Delos sont une RÈGLE, jamais un override : une semaine empêchée se dit via les indisponibilités.
- Pour une petite modification d'un plan déjà en place (« décale ma muscu à jeudi »), appelle replan_week.
- S'il manque une info ESSENTIELLE (quelle semaine ?), pose UNE question courte. Sinon lance-toi : les règles de vie (Delos, Monumia, sport, sorties) sont déjà connues du Conseil, inutile de les redemander.
- Réponds en français, chaleureux et bref. Après un plan : NE réénumère pas les sessions (la carte s'affiche), confirme, relaie les warnings éventuels, propose d'ajuster.

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
    base = COUNCIL_HOST_SYSTEM(today, memoryBlock);
    modeTools = [
      ...councilTools,
      ...tools.filter((t) => ["list_events", "resolve_dates"].includes(t.function.name)),
    ];
  } else if (isJosiane) {
    // Josiane : CRUD complet + retouche du plan, avec le contexte du jour.
    const context = await buildDayContext("josiane", opts?.now);
    base = `${JOSIANE_SYSTEM(today, memoryBlock)}\n\n${context}`;
    modeTools = [
      ...tools.filter((t) => CRUD_TOOL_NAMES.includes(t.function.name)),
      ...councilTools.filter((t) => t.function.name === "replan_week"),
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

  const system = {
    role: "system",
    content: opts?.conversationContext ? base + opts.conversationContext : base,
  };

  const messages: Record<string, unknown>[] = [
    system,
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const ctx: ToolContext = { actions: [] };
  let changed = false;
  const MAX_TURNS = 6;

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const message = await openaiChat({
        model: MODELS.small,
        messages,
        tools: modeTools,
        toolChoice: "auto",
        label: `chat:${mode}`,
      });

      messages.push(message);

      const toolCalls = message.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
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
        const { result, changed: c } = await runTool(
          call.function.name,
          args,
          ctx
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
    if (err instanceof OpenAIError && err.kind === "no-key") {
      return {
        reply:
          "⚠️ La clé API OpenAI n'est pas configurée. Ajoute OPENAI_API_KEY dans ton fichier .env.local puis relance le serveur.",
        actions: ctx.actions,
        changed,
      };
    }
    let reply: string;
    if (err instanceof AgentOutputError) {
      reply = `❌ ${err.agent} n'a pas réussi à produire une réponse exploitable après ${err.attempts} tentatives. Réessaie — si ça persiste, son modèle est peut-être en difficulté.\nDétail : ${err.lastIssues.slice(0, 300)}`;
    } else if (err instanceof OpenAIError) {
      reply = `❌ Erreur de l'API OpenAI${err.status ? ` (${err.status})` : ""} : ${err.message.slice(0, 300)}`;
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

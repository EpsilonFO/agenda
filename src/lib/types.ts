export type EventItem = {
  id: string;
  title: string;
  /** ISO 8601, ex: 2026-07-14T09:00:00 */
  start: string;
  /** ISO 8601 */
  end: string;
  description?: string;
  location?: string;
  /** Catégorie libre : "travail", "sport", "perso"... */
  category?: string;
  /** Couleur hex de la pastille, ex: #6366f1 */
  color?: string;
  /** "plan" si créé par le Conseil (permet de réécrire une semaine sans doublon). */
  source?: "plan";
  createdAt: string;
  updatedAt: string;
};

export type MemoryItem = {
  id: string;
  content: string;
  createdAt: string;
};

/* ----------------------- Lieux & déplacements ----------------------- */

export type Place = {
  id: string;
  name: string;
  /** Type libre : domicile, travail, sport, famille… */
  type?: string;
  /** true pour le point de départ par défaut (domicile principal). */
  isHome?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TransportMode = "à pied" | "vélo" | "voiture" | "métro" | "train" | "bus";

export type TravelTime = {
  id: string;
  fromId: string;
  toId: string;
  minutes: number;
  mode: string;
  updatedAt: string;
};

/* -------------------------- Activités --------------------------------- */

export type SportInfo = {
  intensity: "low" | "moderate" | "high";
  /** Repos minimal conseillé après cette séance, en heures. */
  minRestHoursAfter: number;
  /** Groupes musculaires sollicités (optionnel, pour le coach). */
  muscleGroups?: string[];
};

/**
 * Une activité *flexible* que le planificateur peut caser dans la semaine
 * (salle, piscine, voir sa copine, heures de CDD…). Les activités *fixes*
 * (cours, sport de groupe) restent de simples événements dans events.json.
 */
export type Activity = {
  id: string;
  name: string;
  category?: string;
  placeId?: string;
  durationMin: number;
  /** Nombre de séances visées par semaine. */
  perWeek?: number;
  /** Créneaux préférés : "morning" | "afternoon" | "evening" | jour… (texte libre). */
  preferredWindows?: string[];
  /** Modes de transport possibles pour s'y rendre. */
  transportModes?: string[];
  /** Métadonnées de récupération si c'est du sport. */
  sport?: SportInfo;
  createdAt: string;
  updatedAt: string;
};

export type TransportProfile = {
  /** Modes de transport dont l'utilisateur dispose par défaut. */
  transportModes: string[];
  /** true si la voiture est disponible par défaut (souvent non). */
  carDefault: boolean;
  /** Lieu de départ principal. */
  homePlaceId?: string;
  /** Objectif d'heures de travail flexible par semaine (CDD…). */
  workHoursTarget?: number;
};

/* -------------------------- Travail (Emilien) ------------------------ */

/**
 * Une couche de travail récurrente : le master (cours), la startup Monumia,
 * le CDD Delos… Emilien vise `weeklyHoursTarget` heures par semaine.
 */
export type WorkStream = {
  id: string;
  name: string;
  /** master (cours) | startup | cdd | autre */
  kind: "master" | "startup" | "cdd" | "autre";
  /** Heures visées par semaine pour cette couche. */
  weeklyHoursTarget?: number;
  /** Lieu par défaut (pour les trajets). */
  placeId?: string;
  /** Précisions libres (ex: "surtout le soir", "en présentiel le lundi"). */
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

/** Un travail ponctuel à rendre avant une échéance (TP, dossier…). */
export type Task = {
  id: string;
  title: string;
  /** Couche de travail associée (optionnel). */
  streamId?: string;
  /** Date d'échéance incluse, format YYYY-MM-DD. */
  dueDate: string;
  /** Charge estimée en heures de travail à caser avant l'échéance. */
  estimatedHours: number;
  done?: boolean;
  createdAt: string;
  updatedAt: string;
};

/* ------------------------ Le Conseil (agents) ------------------------ */

/** Les 5 membres nommés du conseil. */
export type AgentName = "emilien" | "jannik" | "djimo" | "simone" | "josiane";

/** Un message échangé entre deux agents pendant la délibération. */
export type CouncilMessage = {
  from: AgentName;
  to: AgentName;
  text: string;
  /** Tour de délibération (0 = première passe, 1 = négociation…). */
  round: number;
};

/** Détail sportif d'une séance planifiée (produit par Jannik). */
export type WorkoutPlan = {
  /** start ISO de la séance concernée (clé de rapprochement). */
  sessionStart: string;
  title: string;
  intensity?: "low" | "moderate" | "high";
  /** Exercices concrets à faire pendant la séance. */
  exercises: string[];
  /** Conseils du coach (échauffement, récup, hydratation…). */
  tips: string[];
};

export type Ingredient = { name: string; qty?: string };

/** Un repas proposé par Simone pour un jour donné. */
export type MealPlan = {
  /** Jour concerné, YYYY-MM-DD. */
  day: string;
  /** Moment : "petit-déj" | "déjeuner" | "dîner" | "collation"… */
  slot: string;
  title: string;
  /** Étapes de la recette. */
  steps: string[];
  ingredients: Ingredient[];
  /** Pourquoi ce plat ce jour-là (lien avec la charge sportive/travail). */
  rationale?: string;
};

/** Liste de courses consolidée pour la semaine. */
export type GroceryList = {
  items: { name: string; qty?: string; aisle?: string }[];
};

/* ------------------------ Plan de semaine ---------------------------- */

/** Une séance proposée par le planificateur (non encore écrite dans l'agenda). */
export type PlannedSession = {
  activityId?: string;
  title: string;
  placeId?: string;
  /** Nom lisible du lieu (dénormalisé pour l'affichage). */
  placeName?: string;
  /** ISO local, ex: 2026-07-20T18:00:00 */
  start: string;
  end: string;
  category?: string;
  /** Mode de transport pour venir depuis la séance/lieu précédent. */
  transportMode?: string;
  /** Minutes de trajet depuis le point précédent. */
  travelFromPrevMin?: number;
  /** Justification courte du placement (trajet, récup…). */
  rationale?: string;
};

export type WeekPlan = {
  weekStart: string;
  /** Toutes les séances placées (travail, sport, loisir) par Josiane. */
  sessions: PlannedSession[];
  /** Détail sportif par séance (exercices + conseils de Jannik). */
  workouts?: WorkoutPlan[];
  /** Repas de la semaine proposés par Simone. */
  meals?: MealPlan[];
  /** Liste de courses consolidée. */
  groceries?: GroceryList;
  /** Délibération visible entre les 5 agents. */
  transcript?: CouncilMessage[];
  /** Note de synthèse du coach sportif (Jannik). */
  coachNote?: string;
  /** Avertissements résiduels (récup, conflits, heures non casées…). */
  warnings?: string[];
  /** true une fois le plan écrit dans l'agenda. */
  committed?: boolean;
};

export type ChatMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  /** présent pour role=assistant quand le modèle appelle des outils */
  tool_calls?: unknown;
  /** présent pour role=tool */
  tool_call_id?: string;
  name?: string;
};

export type AgentResponse = {
  reply: string;
  /** Résumé lisible des actions menées sur l'agenda */
  actions: string[];
  /** true si l'agenda a été modifié et doit être rechargé côté client */
  changed: boolean;
  /** Plan de semaine proposé (à valider) — non encore écrit dans l'agenda. */
  plan?: WeekPlan;
};

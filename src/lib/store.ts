import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import type {
  EventItem,
  MemoryItem,
  Place,
  TravelTime,
  Activity,
  TransportProfile,
  WorkStream,
  Task,
  WeekPlan,
} from "./types";

/**
 * Stockage local ultra-simple sur fichiers JSON.
 * Objectif : rester "facilement modifiable" — tu peux ouvrir et éditer
 * les fichiers data/*.json à la main si besoin.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const EVENTS_FILE = path.join(DATA_DIR, "events.json");
const MEMORY_FILE = path.join(DATA_DIR, "memory.json");
const PLACES_FILE = path.join(DATA_DIR, "places.json");
const TRAVEL_FILE = path.join(DATA_DIR, "travel-times.json");
const ACTIVITIES_FILE = path.join(DATA_DIR, "activities.json");
const PROFILE_FILE = path.join(DATA_DIR, "profile.json");
const WORK_STREAMS_FILE = path.join(DATA_DIR, "work-streams.json");
const TASKS_FILE = path.join(DATA_DIR, "tasks.json");
const PLANS_FILE = path.join(DATA_DIR, "plans.json");

async function ensureFile(file: string, fallback: string): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(file, fallback, "utf8");
  }
}

async function readJson<T>(file: string): Promise<T[]> {
  await ensureFile(file, "[]");
  const raw = await fs.readFile(file, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

async function writeJson<T>(file: string, data: T[]): Promise<void> {
  await ensureFile(file, "[]");
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

function id(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

/**
 * CRUD générique sur une collection JSON identifiée par `id`.
 * Réutilisé pour lieux, trajets et activités.
 */
function collection<T extends { id: string; updatedAt: string }>(file: string) {
  return {
    async list(): Promise<T[]> {
      return readJson<T>(file);
    },
    async create(
      input: Omit<T, "id" | "createdAt" | "updatedAt"> & Partial<Pick<T, "id">>
    ): Promise<T> {
      const items = await readJson<T>(file);
      const item = {
        ...(input as object),
        id: id(),
        createdAt: now(),
        updatedAt: now(),
      } as unknown as T;
      items.push(item);
      await writeJson(file, items);
      return item;
    },
    async update(itemId: string, patch: Partial<T>): Promise<T | null> {
      const items = await readJson<T>(file);
      const idx = items.findIndex((it) => it.id === itemId);
      if (idx === -1) return null;
      items[idx] = { ...items[idx], ...patch, updatedAt: now() };
      await writeJson(file, items);
      return items[idx];
    },
    async remove(itemId: string): Promise<boolean> {
      const items = await readJson<T>(file);
      const next = items.filter((it) => it.id !== itemId);
      if (next.length === items.length) return false;
      await writeJson(file, next);
      return true;
    },
  };
}

/* ---------------------------- Événements ---------------------------- */

export async function listEvents(): Promise<EventItem[]> {
  const events = await readJson<EventItem>(EVENTS_FILE);
  return events.sort((a, b) => a.start.localeCompare(b.start));
}

export async function createEvent(
  input: Omit<EventItem, "id" | "createdAt" | "updatedAt">
): Promise<EventItem> {
  const events = await readJson<EventItem>(EVENTS_FILE);
  const event: EventItem = {
    ...input,
    id: id(),
    createdAt: now(),
    updatedAt: now(),
  };
  events.push(event);
  await writeJson(EVENTS_FILE, events);
  return event;
}

export async function updateEvent(
  eventId: string,
  patch: Partial<Omit<EventItem, "id" | "createdAt">>
): Promise<EventItem | null> {
  const events = await readJson<EventItem>(EVENTS_FILE);
  const idx = events.findIndex((e) => e.id === eventId);
  if (idx === -1) return null;
  events[idx] = { ...events[idx], ...patch, updatedAt: now() };
  await writeJson(EVENTS_FILE, events);
  return events[idx];
}

export async function deleteEvent(eventId: string): Promise<boolean> {
  const events = await readJson<EventItem>(EVENTS_FILE);
  const next = events.filter((e) => e.id !== eventId);
  if (next.length === events.length) return false;
  await writeJson(EVENTS_FILE, next);
  return true;
}

/* ------------------------------ Mémoire ----------------------------- */

export async function listMemory(): Promise<MemoryItem[]> {
  const items = await readJson<MemoryItem>(MEMORY_FILE);
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function addMemory(content: string): Promise<MemoryItem> {
  const items = await readJson<MemoryItem>(MEMORY_FILE);
  const item: MemoryItem = { id: id(), content, createdAt: now() };
  items.push(item);
  await writeJson(MEMORY_FILE, items);
  return item;
}

export async function deleteMemory(memoryId: string): Promise<boolean> {
  const items = await readJson<MemoryItem>(MEMORY_FILE);
  const next = items.filter((m) => m.id !== memoryId);
  if (next.length === items.length) return false;
  await writeJson(MEMORY_FILE, next);
  return true;
}

/* ------------------------------- Lieux ------------------------------ */

const placesCol = collection<Place>(PLACES_FILE);
export const listPlaces = placesCol.list;
export const createPlace = (input: Omit<Place, "id" | "createdAt" | "updatedAt">) =>
  placesCol.create(input);
export const updatePlace = placesCol.update;
export const deletePlace = placesCol.remove;

/* ----------------------------- Trajets ------------------------------ */

const travelCol = collection<TravelTime>(TRAVEL_FILE);
export const listTravelTimes = travelCol.list;
export const createTravelTime = (
  input: Omit<TravelTime, "id" | "updatedAt">
) => travelCol.create(input as Omit<TravelTime, "id" | "createdAt" | "updatedAt">);
export const updateTravelTime = travelCol.update;
export const deleteTravelTime = travelCol.remove;

/* ---------------------------- Activités ----------------------------- */

const activitiesCol = collection<Activity>(ACTIVITIES_FILE);
export const listActivities = activitiesCol.list;
export const createActivity = (
  input: Omit<Activity, "id" | "createdAt" | "updatedAt">
) => activitiesCol.create(input);
export const updateActivity = activitiesCol.update;
export const deleteActivity = activitiesCol.remove;

/* ---------------------------- Profil -------------------------------- */

const DEFAULT_PROFILE: TransportProfile = {
  transportModes: ["à pied", "vélo", "métro"],
  carDefault: false,
};

export async function getProfile(): Promise<TransportProfile> {
  await ensureFile(PROFILE_FILE, JSON.stringify(DEFAULT_PROFILE, null, 2));
  const raw = await fs.readFile(PROFILE_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PROFILE, ...parsed } as TransportProfile;
  } catch {
    return DEFAULT_PROFILE;
  }
}

export async function setProfile(
  patch: Partial<TransportProfile>
): Promise<TransportProfile> {
  const current = await getProfile();
  const next = { ...current, ...patch };
  await fs.writeFile(PROFILE_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}

/* -------------------------- Couches de travail ---------------------- */

const workStreamsCol = collection<WorkStream>(WORK_STREAMS_FILE);
export const listWorkStreams = workStreamsCol.list;
export const createWorkStream = (
  input: Omit<WorkStream, "id" | "createdAt" | "updatedAt">
) => workStreamsCol.create(input);
export const updateWorkStream = workStreamsCol.update;
export const deleteWorkStream = workStreamsCol.remove;

/* --------------------------- TP / échéances ------------------------- */

const tasksCol = collection<Task>(TASKS_FILE);
export const listTasks = tasksCol.list;
export const createTask = (input: Omit<Task, "id" | "createdAt" | "updatedAt">) =>
  tasksCol.create(input);
export const updateTask = tasksCol.update;
export const deleteTask = tasksCol.remove;

/* ------------------------- Plans de semaine ------------------------- */

/**
 * Persiste un plan de semaine complet (une entrée par `weekStart`).
 * Écrase un plan déjà stocké pour la même semaine.
 */
export async function saveWeekPlan(plan: WeekPlan): Promise<WeekPlan> {
  const plans = await readJson<WeekPlan>(PLANS_FILE);
  const next = plans.filter((p) => p.weekStart !== plan.weekStart);
  next.push(plan);
  await writeJson(PLANS_FILE, next);
  return plan;
}

/** Renvoie le plan stocké pour une semaine donnée, ou null. */
export async function getWeekPlan(weekStart: string): Promise<WeekPlan | null> {
  const plans = await readJson<WeekPlan>(PLANS_FILE);
  return plans.find((p) => p.weekStart === weekStart) || null;
}

export async function listWeekPlans(): Promise<WeekPlan[]> {
  const plans = await readJson<WeekPlan>(PLANS_FILE);
  return plans.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

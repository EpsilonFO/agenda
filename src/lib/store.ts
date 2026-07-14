import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import type { EventItem, MemoryItem } from "./types";

/**
 * Stockage local ultra-simple sur fichiers JSON.
 * Objectif : rester "facilement modifiable" — tu peux ouvrir et éditer
 * data/events.json ou data/memory.json à la main si besoin.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const EVENTS_FILE = path.join(DATA_DIR, "events.json");
const MEMORY_FILE = path.join(DATA_DIR, "memory.json");

async function ensureFile(file: string): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(file, "[]", "utf8");
  }
}

async function readJson<T>(file: string): Promise<T[]> {
  await ensureFile(file);
  const raw = await fs.readFile(file, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

async function writeJson<T>(file: string, data: T[]): Promise<void> {
  await ensureFile(file);
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

function id(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
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

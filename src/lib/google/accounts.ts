import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

/**
 * Comptes Google connectés (data/google-accounts.json) — même esprit
 * « fichier JSON local » que le reste du stockage. Contient les refresh
 * tokens : le fichier est gitignoré (data/*.json) et à traiter comme
 * credentials.json.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "google-accounts.json");

export type DetailLevel = "full" | "busy";

export type GoogleAccount = {
  id: string;
  email: string;
  name?: string;

  /* --- secrets --- */
  refreshToken: string;
  accessToken?: string;
  /** ISO UTC d'expiration de l'access token. */
  accessTokenExpiresAt?: string;
  scope?: string;

  /* --- réglages --- */
  /** Calendrier synchronisé ("primary" ou un id de calendrier). */
  calendarId: string;
  calendarSummary?: string;
  /** Pousser les événements de l'agenda vers ce calendrier. */
  push: boolean;
  /** Importer les événements de ce calendrier dans l'agenda. */
  pull: boolean;
  /** "full" = titre/lieu/notes réels ; "busy" = bloc « Occupé » privé. */
  detail: DetailLevel;
  busyTitle: string;
  /** Catégorie donnée aux événements importés. */
  category: string;
  /** Catégories locales jamais poussées vers ce calendrier. */
  excludeCategories: string[];

  /* --- état --- */
  status: "ok" | "reauth" | "error";
  lastSyncAt?: string;
  lastError?: string;
  lastStats?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

/** Vue sans secrets, exposée à l'UI. */
export type PublicGoogleAccount = Omit<
  GoogleAccount,
  "refreshToken" | "accessToken" | "accessTokenExpiresAt"
>;

export function toPublic(a: GoogleAccount): PublicGoogleAccount {
  const { refreshToken: _r, accessToken: _a, accessTokenExpiresAt: _e, ...rest } = a;
  void _r;
  void _a;
  void _e;
  return rest;
}

const DEFAULT_SETTINGS = {
  calendarId: "primary",
  push: true,
  pull: true,
  detail: "full" as DetailLevel,
  busyTitle: "Occupé",
  category: "travail",
  excludeCategories: [] as string[],
};

async function read(): Promise<GoogleAccount[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Défauts matérialisés pour les comptes créés par une version antérieure.
    return parsed.map((a) => ({ ...DEFAULT_SETTINGS, status: "ok", ...a })) as GoogleAccount[];
  } catch {
    return [];
  }
}

async function write(items: GoogleAccount[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(items, null, 2), "utf8");
}

export async function listAccounts(): Promise<GoogleAccount[]> {
  return read();
}

export async function getAccount(id: string): Promise<GoogleAccount | null> {
  return (await read()).find((a) => a.id === id) || null;
}

export type TokenInput = {
  email: string;
  name?: string;
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiresAt?: string;
  scope?: string;
};

/**
 * Enregistre un compte fraîchement autorisé. Si l'email est déjà connu, seuls
 * les jetons sont remplacés (les réglages survivent à une reconnexion).
 */
export async function upsertAccountByEmail(
  input: TokenInput,
  nowIso: string
): Promise<GoogleAccount> {
  const items = await read();
  const email = input.email.toLowerCase();
  const idx = items.findIndex((a) => a.email.toLowerCase() === email);
  if (idx !== -1) {
    items[idx] = {
      ...items[idx],
      name: input.name ?? items[idx].name,
      refreshToken: input.refreshToken,
      accessToken: input.accessToken,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      scope: input.scope ?? items[idx].scope,
      status: "ok",
      lastError: undefined,
      updatedAt: nowIso,
    };
    await write(items);
    return items[idx];
  }
  const account: GoogleAccount = {
    id: crypto.randomUUID(),
    email,
    name: input.name,
    refreshToken: input.refreshToken,
    accessToken: input.accessToken,
    accessTokenExpiresAt: input.accessTokenExpiresAt,
    scope: input.scope,
    ...DEFAULT_SETTINGS,
    status: "ok",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  items.push(account);
  await write(items);
  return account;
}

export async function updateAccount(
  id: string,
  patch: Partial<Omit<GoogleAccount, "id" | "createdAt">>
): Promise<GoogleAccount | null> {
  const items = await read();
  const idx = items.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  items[idx] = { ...items[idx], ...patch, updatedAt: new Date().toISOString() };
  await write(items);
  return items[idx];
}

export async function removeAccount(id: string): Promise<GoogleAccount | null> {
  const items = await read();
  const found = items.find((a) => a.id === id) || null;
  if (found) await write(items.filter((a) => a.id !== id));
  return found;
}

/** Compte par défaut pour ENVOYER une invitation : le premier compte actif qui pousse. */
export async function defaultInviteAccount(): Promise<GoogleAccount | null> {
  const items = await read();
  return items.find((a) => a.push && a.status !== "reauth") || items[0] || null;
}

/* ---------------------- Validation des réglages (PATCH) ---------------------- */

function parseCategoryList(v: unknown): string[] | undefined {
  if (Array.isArray(v)) {
    return v.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  }
  if (typeof v === "string") {
    return v
      .split(/[,\n;]/)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
  }
  return undefined;
}

/**
 * Ne garde du corps que les réglages modifiables par l'UI, typés proprement.
 * Tout le reste (jetons, statut, id…) est ignoré.
 */
export function sanitizeSettingsPatch(body: unknown): Partial<GoogleAccount> {
  if (!body || typeof body !== "object") return {};
  const b = body as Record<string, unknown>;
  const patch: Partial<GoogleAccount> = {};
  if (typeof b.calendarId === "string" && b.calendarId.trim()) {
    patch.calendarId = b.calendarId.trim();
  }
  if (typeof b.calendarSummary === "string") patch.calendarSummary = b.calendarSummary;
  if (typeof b.push === "boolean") patch.push = b.push;
  if (typeof b.pull === "boolean") patch.pull = b.pull;
  if (b.detail === "full" || b.detail === "busy") patch.detail = b.detail;
  if (typeof b.busyTitle === "string") patch.busyTitle = b.busyTitle.trim() || "Occupé";
  if (typeof b.category === "string") {
    patch.category = b.category.trim().toLowerCase() || "travail";
  }
  const excl = parseCategoryList(b.excludeCategories);
  if (excl) patch.excludeCategories = excl;
  return patch;
}

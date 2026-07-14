import { promises as fs } from "fs";
import path from "path";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";

/**
 * Authentification par passkey (WebAuthn). Stockage des identifiants (clé
 * publique + compteur) dans data/credentials.json, dans le même esprit
 * fichier-JSON que le reste du projet (store.ts).
 */

const DATA_DIR = path.join(process.cwd(), "data");
const CRED_FILE = path.join(DATA_DIR, "credentials.json");

/** Identité (application mono-utilisateur). */
export const RP_NAME = "Agenda IA";
export const RP_ID = process.env.WEBAUTHN_RP_ID || "localhost";
export const ORIGIN = process.env.WEBAUTHN_ORIGIN || "http://localhost:3111";
export const USER_NAME = "felix";
/** Handle utilisateur stable (mono-utilisateur). */
export const USER_ID = new TextEncoder().encode("agenda-felix");

export function sessionSecret(): string {
  return process.env.SESSION_SECRET || "";
}
export function sessionDays(): number {
  return Number(process.env.SESSION_DAYS || 30);
}
/** Cookies sécurisés dès que l'origin est en https (donc pas en local http). */
export function cookieSecure(): boolean {
  return ORIGIN.startsWith("https://");
}

export type StoredCredential = {
  /** ID du credential, base64url. */
  id: string;
  /** Clé publique COSE, base64url. */
  publicKey: string;
  counter: number;
  transports?: AuthenticatorTransportFuture[];
  label?: string;
  createdAt: string;
};

export async function listCredentials(): Promise<StoredCredential[]> {
  try {
    const raw = await fs.readFile(CRED_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeCredentials(creds: StoredCredential[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CRED_FILE, JSON.stringify(creds, null, 2), "utf8");
}

/** Ajoute (ou remplace) un credential, dédupliqué par id. */
export async function saveCredential(cred: StoredCredential): Promise<void> {
  const creds = await listCredentials();
  const next = creds.filter((c) => c.id !== cred.id);
  next.push(cred);
  await writeCredentials(next);
}

/** Met à jour le compteur anti-rejeu d'un credential. */
export async function updateCounter(id: string, counter: number): Promise<void> {
  const creds = await listCredentials();
  const idx = creds.findIndex((c) => c.id === id);
  if (idx === -1) return;
  creds[idx].counter = counter;
  await writeCredentials(creds);
}

/* Encodage/décodage de la clé publique (Uint8Array <-> base64url). */
export function encodePublicKey(bytes: Uint8Array): string {
  return isoBase64URL.fromBuffer(bytes);
}
export function decodePublicKey(b64: string): Uint8Array {
  return isoBase64URL.toBuffer(b64);
}

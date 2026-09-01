import { promises as fs } from "fs";
import path from "path";

/**
 * Pierres tombales : un événement IMPORTÉ de Google puis supprimé dans
 * l'agenda doit aussi disparaître côté Google, sinon la synchro (qui
 * réconcilie par comparaison d'état) le ré-importerait au passage suivant.
 * On note donc la suppression ici ; la synchro la rejoue puis l'efface.
 *
 * Module volontairement minuscule et sans dépendance vers store.ts (qui
 * l'importe) pour éviter tout cycle.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "google-tombstones.json");

export type Tombstone = {
  accountId: string;
  calendarId: string;
  eventId: string;
  title?: string;
  /** ISO UTC de la suppression locale. */
  deletedAt: string;
};

async function read(): Promise<Tombstone[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Tombstone[]) : [];
  } catch {
    return [];
  }
}

async function write(items: Tombstone[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(items, null, 2), "utf8");
}

export async function listTombstones(): Promise<Tombstone[]> {
  return read();
}

/** Ajoute une pierre tombale (dédupliquée par compte + événement). */
export async function addTombstone(t: Tombstone): Promise<void> {
  const items = await read();
  const next = items.filter(
    (x) => !(x.accountId === t.accountId && x.eventId === t.eventId)
  );
  next.push(t);
  await write(next);
}

/** Retire les pierres tombales listées (par compte + événement). */
export async function removeTombstones(
  done: Pick<Tombstone, "accountId" | "eventId">[]
): Promise<void> {
  if (done.length === 0) return;
  const items = await read();
  const keys = new Set(done.map((d) => `${d.accountId}|${d.eventId}`));
  await write(items.filter((x) => !keys.has(`${x.accountId}|${x.eventId}`)));
}

/** Efface toutes les pierres tombales d'un compte (déconnexion). */
export async function clearTombstonesForAccount(accountId: string): Promise<void> {
  const items = await read();
  await write(items.filter((x) => x.accountId !== accountId));
}

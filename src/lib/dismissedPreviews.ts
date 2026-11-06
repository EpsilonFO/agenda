import { promises as fs } from "fs";
import path from "path";

/**
 * Aperçus de sports imposés (lib/fixedSports.ts) écartés à la main : « pas de
 * natation ce jeudi ». Sans cette liste, supprimer la séance (ou l'aperçu
 * lui-même) libérait le créneau… et l'aperçu revenait aussitôt, en
 * transparent. On note donc l'id de l'aperçu (`fixed-sport:<activité>:<date>`),
 * côté serveur pour que le téléphone et l'ordinateur soient d'accord.
 *
 * Les entrées passées ne servent plus (pas d'aperçu pour les jours passés) :
 * on les purge à chaque écriture.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "dismissed-previews.json");

async function read(): Promise<string[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(FILE, "utf8"));
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Date (AAAA-MM-JJ) portée par un id d'aperçu, ou null. */
function dateOf(id: string): string | null {
  const m = /:(\d{4}-\d{2}-\d{2})$/.exec(id);
  return m ? m[1]! : null;
}

export async function listDismissedPreviews(): Promise<string[]> {
  return read();
}

export async function dismissPreviews(ids: string[], now: Date = new Date()): Promise<string[]> {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
  const all = new Set(await read());
  for (const id of ids) all.add(id);
  const kept = [...all].filter((id) => {
    const d = dateOf(id);
    return d !== null && d >= today;
  });
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(kept, null, 2), "utf8");
  return kept;
}

import type { Attendee, InviteInfo } from "../types";
import { defaultInviteAccount, getAccount } from "./accounts";

/**
 * Normalisation des invités saisis (UI, Josiane) et choix du compte Google
 * qui portera l'invitation.
 */

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/**
 * Accepte une liste d'emails, une chaîne « a@x.fr, b@y.fr », ou des objets
 * {email,…}. Déduplique, met en minuscules, ignore le non-email.
 */
export function normalizeAttendees(input: unknown): Attendee[] {
  const raw: unknown[] = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[,;\s]+/)
      : [];
  const seen = new Set<string>();
  const out: Attendee[] = [];
  for (const item of raw) {
    let a: Attendee | null = null;
    if (typeof item === "string") {
      const email = item.trim().replace(/^<|>$/g, "").toLowerCase();
      if (EMAIL_RE.test(email)) a = { email };
    } else if (item && typeof item === "object" && typeof (item as Attendee).email === "string") {
      const o = item as Attendee;
      const email = o.email.trim().toLowerCase();
      if (EMAIL_RE.test(email)) {
        a = { email };
        if (o.displayName) a.displayName = o.displayName;
        if (o.responseStatus) a.responseStatus = o.responseStatus;
        if (o.optional) a.optional = true;
        if (o.self) a.self = true;
        if (o.organizer) a.organizer = true;
      }
    }
    if (a && !seen.has(a.email)) {
      seen.add(a.email);
      out.push(a);
    }
  }
  return out;
}

/**
 * Compte qui enverra l'invitation : celui demandé s'il existe, sinon le
 * compte par défaut. null si aucun compte Google n'est connecté.
 */
export async function resolveInvite(
  requestedAccountId?: string | null,
  current?: InviteInfo
): Promise<InviteInfo | undefined> {
  if (requestedAccountId) {
    const acc = await getAccount(requestedAccountId);
    if (acc) {
      return current?.accountId === acc.id ? current : { accountId: acc.id };
    }
  }
  if (current?.accountId) return current;
  const def = await defaultInviteAccount();
  return def ? { accountId: def.id } : undefined;
}

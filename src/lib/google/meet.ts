import crypto from "crypto";
import { getEvent } from "../store";
import type { MeetInfo } from "../types";
import { runGoogleSync } from "./sync";

/**
 * Les visios Google Meet.
 *
 * L'agenda ne fabrique pas de lien : il en DEMANDE un à Google Calendar, qui
 * crée une vraie conférence (`conferenceData.createRequest`) et la joint à
 * l'événement. Le lien part donc tout seul dans l'invitation envoyée aux
 * invités, et il s'affiche dans l'agenda une fois relevé par la synchro.
 *
 * `requestId` est l'identifiant de la DEMANDE : stable et unique par
 * événement, pour que la rejouer ne crée pas une deuxième conférence.
 */

export function newMeetRequest(): MeetInfo {
  return { requestId: crypto.randomUUID() };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Pousse l'événement vers Google MAINTENANT et rend le lien de la visio, pour
 * pouvoir l'annoncer dans la foulée au lieu d'attendre le passage automatique.
 *
 * Google crée la conférence de façon asynchrone : le lien revient presque
 * toujours avec l'insert, sinon on redemande une fois. S'il n'est toujours pas
 * là, ce n'est pas un échec — la synchro suivante le relèvera (plan.ts).
 */
export async function createMeetNow(
  eventId: string,
  accountId: string
): Promise<{ uri?: string; error?: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(1200);
    const report = await runGoogleSync({ accountId });
    const account = report.accounts.find((a) => a.accountId === accountId);
    if (report.skipped) return { error: report.skipped };
    if (account && !account.ok) return { error: account.error || "synchro Google en échec" };
    const fresh = await getEvent(eventId);
    if (fresh?.meet?.uri) return { uri: fresh.meet.uri };
  }
  return {};
}

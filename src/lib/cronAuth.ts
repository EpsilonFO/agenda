/**
 * Autorisation des endpoints déclenchés par un cron externe : secret partagé
 * dans `Authorization: Bearer <CRON_SECRET>` (ou `?secret=` en repli).
 * Sans CRON_SECRET configuré, on refuse tout par prudence.
 */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  if (header === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  return url.searchParams.get("secret") === secret;
}

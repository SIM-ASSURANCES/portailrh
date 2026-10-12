import { timingSafeEqual } from "node:crypto";

/**
 * Authentification des tâches planifiées (cron-job.org, Pointage V2 lot 5) : l'en-tête `Authorization` doit valoir
 * exactement `Bearer <CRON_SECRET>`. Comparaison à temps constant (`timingSafeEqual`) ; refus si le secret n'est pas
 * configuré (ou vide) ou si l'en-tête manque — aucune exécution sans secret valide.
 */
export function secretCronValide(authorization: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret || !authorization) return false;
  const attendu = Buffer.from(`Bearer ${secret}`);
  const recu = Buffer.from(authorization);
  // `timingSafeEqual` exige deux tampons de même longueur ; une longueur différente ne révèle rien du secret.
  if (recu.length !== attendu.length) return false;
  return timingSafeEqual(recu, attendu);
}

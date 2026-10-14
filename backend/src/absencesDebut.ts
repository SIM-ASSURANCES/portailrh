/**
 * Date de départ de la tâche des absences — LOGIQUE PURE (2026-10-14). La tâche ne crée jamais d'absence antérieure à la plus
 * récente de ces trois dates, ce qui supprime toute dépendance au superviseur pour `SYSTEM_START_DATE` après une purge :
 * - `SYSTEM_START_DATE` (plancher de configuration) ;
 * - le LENDEMAIN du jour de la dernière purge du Pointage : la purge a supprimé les pointages de ce jour-là, la tâche y verrait
 *   à tort des absents ; l'audit des purges (`ReinitialisationPointage.effectueeAt`) en garde la date ;
 * - le jour de la mise en service du Pointage (`PointageMiseEnService.misEnServiceAt`), inclus : rien n'y a été supprimé.
 * Toutes les dates sont ramenées à 00:00 en heure locale du serveur, comme le reste du module.
 */

function debutDuJour(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

export function dateDebutAbsences(params: {
  systemStartDate: Date;
  dernierePurge?: Date | null;
  miseEnService?: Date | null;
}): Date {
  const candidats = [debutDuJour(params.systemStartDate)];
  if (params.dernierePurge) {
    const p = params.dernierePurge;
    candidats.push(new Date(p.getFullYear(), p.getMonth(), p.getDate() + 1));
  }
  if (params.miseEnService) candidats.push(debutDuJour(params.miseEnService));
  return new Date(Math.max(...candidats.map((c) => c.getTime())));
}

import { estJourNonOuvre, prisma } from "backend";

/**
 * Jour non ouvré pour une date (Pointage V2, lot 3 bis) : week-end ou jour férié de la table `JourFerie`, la même
 * source que la détection des absences. Renvoie aussi le jour férié éventuel (son libellé s'affiche à l'écran).
 */
export async function lireJourNonOuvre(date: Date) {
  const debut = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const fin = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  const jourFerie = await prisma.jourFerie.findFirst({ where: { date: { gte: debut, lte: fin } } });
  return { jourNonOuvre: estJourNonOuvre(date, jourFerie ? [jourFerie.date] : []), jourFerie };
}

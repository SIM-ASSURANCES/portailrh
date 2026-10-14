import { JOURS_CONSERVATION_JOURNAUX, prisma } from "backend";

export interface BilanPurge {
  executionsSupprimees: number;
  incidentsSupprimes: number;
}

/**
 * Purge quotidienne (03:00) : supprime les exécutions de tâches de plus de `JOURS_CONSERVATION_JOURNAUX` jours (90).
 * Les incidents du journal technique y seront ajoutés avec la phase 3.
 */
export async function executerPurge(): Promise<BilanPurge> {
  const limite = new Date(Date.now() - JOURS_CONSERVATION_JOURNAUX * 24 * 60 * 60 * 1000);
  const executions = await prisma.executionTache.deleteMany({ where: { debut: { lt: limite } } });
  return { executionsSupprimees: executions.count, incidentsSupprimes: 0 };
}

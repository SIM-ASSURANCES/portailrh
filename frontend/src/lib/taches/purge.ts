import { JOURS_CONSERVATION_JOURNAUX, prisma } from "backend";

export interface BilanPurge {
  executionsSupprimees: number;
  incidentsSupprimes: number;
}

/**
 * Purge quotidienne (03:00) : supprime les exécutions de tâches (`ExecutionTache`) et les incidents du journal technique
 * (`JournalTechnique`) de plus de `JOURS_CONSERVATION_JOURNAUX` jours (90).
 */
export async function executerPurge(): Promise<BilanPurge> {
  const limite = new Date(Date.now() - JOURS_CONSERVATION_JOURNAUX * 24 * 60 * 60 * 1000);
  const executions = await prisma.executionTache.deleteMany({ where: { debut: { lt: limite } } });
  const incidents = await prisma.journalTechnique.deleteMany({ where: { createdAt: { lt: limite } } });
  return { executionsSupprimees: executions.count, incidentsSupprimes: incidents.count };
}

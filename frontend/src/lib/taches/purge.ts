import { JOURS_CONSERVATION_JOURNAUX, jourCourant, prisma, purgerQuotasFeedback } from "backend";

export interface BilanPurge {
  executionsSupprimees: number;
  incidentsSupprimes: number;
  quotasFeedbackSupprimes: number;
}

/**
 * Purge quotidienne (03:00) : supprime les exécutions de tâches (`ExecutionTache`) et les incidents du journal technique
 * (`JournalTechnique`) de plus de `JOURS_CONSERVATION_JOURNAUX` jours (90), et les traces de quota FeedbackApp des jours
 * antérieurs au jour courant (`FeedbackQuota`).
 */
export async function executerPurge(): Promise<BilanPurge> {
  const limite = new Date(Date.now() - JOURS_CONSERVATION_JOURNAUX * 24 * 60 * 60 * 1000);
  const executions = await prisma.executionTache.deleteMany({ where: { debut: { lt: limite } } });
  const incidents = await prisma.journalTechnique.deleteMany({ where: { createdAt: { lt: limite } } });
  const quotasFeedbackSupprimes = await purgerQuotasFeedback(jourCourant());
  return { executionsSupprimees: executions.count, incidentsSupprimes: incidents.count, quotasFeedbackSupprimes };
}

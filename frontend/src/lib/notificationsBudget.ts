import { phrasesAlertes, prisma, type PrevisionBudget } from "backend";

import { notify, notifyByPermission } from "@/lib/notifications";

/**
 * Notifications des budgets (lot J). Appelées APRÈS l'écriture : un échec d'envoi est journalisé, jamais remonté (la décision
 * est déjà enregistrée). Les destinataires sont choisis par PERMISSION, jamais par nom de rôle.
 */

const LIEN_BUDGETS = "/treso/finance/budgets";

/** Alerte ORANGE (validation autorisée) ou ROUGE confirmée par le DG : la Finance et le DG sont prévenus, sauf l'auteur de la validation. */
export async function notifierAlerteBudget(demandeId: string, acteurId: string, prevision: PrevisionBudget): Promise<void> {
  if (prevision.niveau === "AUCUN") return;
  try {
    const demande = await prisma.demande.findUnique({ where: { id: demandeId }, select: { reference: true } });
    if (!demande) return;
    const rouge = prevision.niveau === "ROUGE";
    const params = {
      titre: rouge ? "Alerte rouge sur un budget (dépassement confirmé par le DG)" : "Alerte orange sur un budget",
      message: `Validation de la demande ${demande.reference} : ${phrasesAlertes(prevision).join(" ; ")}.`,
      lien: `/treso/finance/demandes/${demandeId}`,
      priority: rouge ? ("CRITIQUE" as const) : ("IMPORTANT" as const),
      category: "TRESORERIE" as const,
      excludeUserId: acteurId,
    };
    await Promise.all([notifyByPermission("treso.decider_finance", params), notifyByPermission("treso.decider_dg", params)]);
  } catch (e) {
    console.error(`[Budget] Notification d'alerte (demande ${demandeId}) impossible :`, e);
  }
}

/** La Finance demande au DG de confirmer un dépassement rouge. */
export async function notifierDemandeConfirmationDepassement(demandeId: string, reference: string, resume: string, acteurId: string): Promise<void> {
  try {
    await notifyByPermission("treso.decider_dg", {
      titre: "Confirmation de dépassement de budget demandée",
      message: `La validation de la demande ${reference} atteint le seuil rouge : ${resume}. Votre confirmation (avec motif) est nécessaire.`,
      lien: LIEN_BUDGETS,
      priority: "IMPORTANT",
      category: "TRESORERIE",
      excludeUserId: acteurId,
    });
  } catch (e) {
    console.error(`[Budget] Notification de demande de confirmation (demande ${demandeId}) impossible :`, e);
  }
}

/** Le DG a confirmé : la Finance qui l'avait demandé peut valider. */
export async function notifierConfirmationDepassement(demandeId: string, reference: string, demandeParId: string, motif: string): Promise<void> {
  try {
    await notify({
      userId: demandeParId,
      titre: "Dépassement de budget confirmé par le DG",
      message: `Le DG a confirmé le dépassement pour la demande ${reference} (motif : ${motif}). Vous pouvez maintenant valider.`,
      lien: `/treso/finance/demandes/${demandeId}`,
      priority: "IMPORTANT",
      category: "TRESORERIE",
    });
  } catch (e) {
    console.error(`[Budget] Notification de confirmation (demande ${demandeId}) impossible :`, e);
  }
}

/** Un paramétrage de budget vient d'être soumis : le DG est prévenu. */
export async function notifierParametrageSoumis(acteurId: string, description: string): Promise<void> {
  try {
    await notifyByPermission("treso.valider_budget", {
      titre: "Budget à valider",
      message: `La Finance a soumis un paramétrage de budget : ${description}. Il n'est utilisable qu'après votre validation.`,
      lien: LIEN_BUDGETS,
      priority: "IMPORTANT",
      category: "TRESORERIE",
      excludeUserId: acteurId,
    });
  } catch (e) {
    console.error("[Budget] Notification de soumission impossible :", e);
  }
}

/** Décision du DG sur un paramétrage : la Finance qui l'avait soumis est prévenue (motif en cas de refus). */
export async function notifierDecisionParametrage(soumisParId: string | null, description: string, valide: boolean, motif?: string): Promise<void> {
  if (!soumisParId) return;
  try {
    await notify({
      userId: soumisParId,
      titre: valide ? "Budget validé par le DG" : "Budget refusé par le DG",
      message: valide ? `Le paramétrage ${description} est validé : il s'applique à sa date d'effet.` : `Le paramétrage ${description} a été refusé — motif : ${motif ?? "—"}.`,
      lien: LIEN_BUDGETS,
      priority: "IMPORTANT",
      category: "TRESORERIE",
    });
  } catch (e) {
    console.error("[Budget] Notification de décision impossible :", e);
  }
}

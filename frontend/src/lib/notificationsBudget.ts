import { phrasesAlertes, prisma, type PrevisionBudget } from "backend";

import { notify, notifyByPermission } from "@/lib/notifications";

/**
 * Notifications des budgets (lot J). Appelées APRÈS l'écriture : un échec d'envoi est journalisé, jamais remonté (la décision
 * est déjà enregistrée). Les destinataires sont choisis par PERMISSION, jamais par nom de rôle.
 */

const LIEN_BUDGETS = "/treso/finance/budgets";

type PorteeNotif = "GLOBAL" | "CATEGORIE";

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

/**
 * Un lot de paramétrages vient d'être soumis : le DG reçoit UNE notification pour tout le lot, propre à la section (lot J quater) —
 * « Seuils de caisse à valider » pour le budget de caisse, « Budget(s) de catégorie à valider » pour les catégories.
 */
export async function notifierParametragesSoumis(acteurId: string, nombre: number, description: string, portee: PorteeNotif): Promise<void> {
  try {
    const caisse = portee === "GLOBAL";
    await notifyByPermission("treso.valider_budget", {
      titre: caisse ? "Seuils de caisse à valider" : nombre === 1 ? "Budget de catégorie à valider" : `${nombre} budgets de catégorie à valider`,
      message: caisse
        ? `La Finance a soumis de nouveaux seuils d'alerte pour le solde de caisse : ${description}. Ils ne sont utilisables qu'après votre validation.`
        : nombre === 1
          ? `La Finance a soumis un budget de catégorie : ${description}. Il n'est utilisable qu'après votre validation.`
          : `La Finance a soumis ${nombre} budgets de catégorie : ${description}. Ils ne sont utilisables qu'après votre validation.`,
      lien: LIEN_BUDGETS,
      priority: "IMPORTANT",
      category: "TRESORERIE",
      excludeUserId: acteurId,
    });
  } catch (e) {
    console.error("[Budget] Notification de soumission impossible :", e);
  }
}

/**
 * Décision du DG sur un ou plusieurs paramétrages d'une section : UNE notification par compte qui avait soumis (le plus souvent un
 * seul), qui liste chaque élément décidé (et le motif en cas de refus). Jamais une notification par élément. Titres propres à la section.
 */
export async function notifierDecisionParametrages(
  decides: { description: string; soumisParId: string | null; motif: string | null }[],
  valide: boolean,
  portee: PorteeNotif
): Promise<void> {
  const parSoumetteur = new Map<string, typeof decides>();
  for (const d of decides) {
    if (!d.soumisParId) continue;
    parSoumetteur.set(d.soumisParId, [...(parSoumetteur.get(d.soumisParId) ?? []), d]);
  }
  for (const [userId, liste] of parSoumetteur) {
    try {
      const detail = liste.map((d) => (valide ? d.description : `${d.description} (motif : ${d.motif ?? "—"})`)).join(" ; ");
      const n = liste.length;
      const titre =
        portee === "GLOBAL"
          ? valide ? "Seuils de caisse validés par le DG" : "Seuils de caisse refusés par le DG"
          : valide
            ? n === 1 ? "Budget de catégorie validé par le DG" : `${n} budgets de catégorie validés par le DG`
            : n === 1 ? "Budget de catégorie refusé par le DG" : `${n} budgets de catégorie refusés par le DG`;
      await notify({
        userId,
        titre,
        message: valide ? `Validé : ${detail}. ${n === 1 ? "Il s'applique" : "Ils s'appliquent"} à ${n === 1 ? "sa" : "leur"} date d'effet.` : `Refusé : ${detail}.`,
        lien: LIEN_BUDGETS,
        priority: "IMPORTANT",
        category: "TRESORERIE",
      });
    } catch (e) {
      console.error("[Budget] Notification de décision impossible :", e);
    }
  }
}

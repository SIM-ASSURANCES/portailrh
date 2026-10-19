"use server";

import { revalidatePath } from "next/cache";

import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import {
  notifierConfirmationDepassement,
  notifierDecisionParametrage,
  notifierDemandeConfirmationDepassement,
  notifierParametrageSoumis,
} from "@/lib/notificationsBudget";
import {
  ajoutsPourArticles,
  confirmerDepassementBudget,
  demanderConfirmationDepassement,
  deciderParametrageBudget,
  prisma,
  soumettreParametrageBudget,
  type AjoutBudget,
  type SaisieParametrage,
} from "backend";

/**
 * Actions des budgets (lot J, 2026-10-19). Chaque action revérifie sa permission ici, jamais seulement le masquage d'un bouton :
 *   - paramétrer (soumettre au DG)            : `treso.modifier_budget_categorie` (la Finance) ;
 *   - valider / refuser un paramétrage        : `treso.valider_budget` (le DG), jamais le compte qui l'a soumis ;
 *   - demander la confirmation d'un dépassement rouge : `treso.decider_finance` (la Finance) ;
 *   - confirmer un dépassement rouge          : `treso.decider_dg` (le DG seul — jamais délégable).
 * Aucune de ces actions n'écrit de budget « en place » ni dans `JournalCaisse`.
 */

export interface ResultatBudgetAction {
  status: "success" | "error";
  message: string;
  erreurs?: Record<string, string>;
}

function rafraichir(demandeId?: string) {
  revalidatePath("/treso/finance", "layout");
  if (demandeId) {
    revalidatePath(`/treso/finance/demandes/${demandeId}`);
    revalidatePath(`/treso/dg/${demandeId}`);
  }
  revalidatePath("/treso/dg");
  publishDataChanged();
}

const NON_AUTORISE: ResultatBudgetAction = { status: "error", message: "Action non autorisée." };

/** Saisie reçue du client, recopiée champ par champ (jamais l'objet reçu tel quel). */
function saisieRecue(s: unknown): SaisieParametrage | null {
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  const seuil = o.seuil && typeof o.seuil === "object" ? (o.seuil as Record<string, unknown>) : null;
  return {
    portee: o.portee === "GLOBAL" ? "GLOBAL" : "CATEGORIE",
    categorieId: typeof o.categorieId === "string" && o.categorieId ? o.categorieId : null,
    montant: Number(o.montant),
    dateDebut: String(o.dateDebut ?? ""),
    dateFin: typeof o.dateFin === "string" && o.dateFin ? o.dateFin : null,
    seuil: seuil
      ? { mode: seuil.mode === "MONTANT" ? "MONTANT" : seuil.mode === "POURCENTAGE" ? "POURCENTAGE" : ("" as never), orange: Number(seuil.orange), rouge: Number(seuil.rouge) }
      : null,
  };
}

/** La Finance soumet un paramétrage au DG (budget global ou d'une catégorie). Sans effet tant que le DG ne l'a pas validé. */
export async function soumettreParametrageBudgetAction(saisie: SaisieParametrage): Promise<ResultatBudgetAction> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.modifier_budget_categorie")) return NON_AUTORISE;
  const s = saisieRecue(saisie);
  if (!s) return { status: "error", message: "Saisie invalide." };

  const r = await soumettreParametrageBudget(s, session.user.id);
  if (!r.ok) return { status: "error", message: r.message, erreurs: r.erreurs };

  const cible = s.portee === "GLOBAL" ? "budget global" : "budget de catégorie";
  await notifierParametrageSoumis(session.user.id, `${cible} de ${s.montant.toLocaleString("fr-FR")} FCFA à partir du ${s.dateDebut.split("-").reverse().join("/")}`);
  rafraichir();
  return { status: "success", message: "Paramétrage soumis au DG : il ne sera pris en compte qu'une fois validé." };
}

/** Le DG valide ou refuse (motif obligatoire au refus) un paramétrage soumis. */
export async function deciderParametrageBudgetAction(id: string, valider: boolean, motif?: string): Promise<ResultatBudgetAction> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.valider_budget")) return NON_AUTORISE;

  const r = await deciderParametrageBudget(String(id), valider === true, motif === undefined ? null : String(motif), session.user.id);
  if (!r.ok) return { status: "error", message: r.message };

  await notifierDecisionParametrage(r.soumisParId, r.portee === "GLOBAL" ? "du budget global" : "d'un budget de catégorie", valider === true, motif);
  rafraichir();
  return {
    status: "success",
    message: valider === true ? "Paramétrage validé : il s'applique à sa date d'effet." : "Paramétrage refusé : la Finance en est informée.",
  };
}

/**
 * La Finance demande au DG de confirmer un dépassement rouge pour la validation en cours (articles cochés, ou montant d'une
 * dépense directe). Le prévisionnel est recalculé côté serveur : le client ne transmet que ce qu'il voudrait valider.
 */
export async function demanderConfirmationDepassementAction(
  demandeId: string,
  ligneIds: string[],
  montantDepenseDirecte?: number
): Promise<ResultatBudgetAction> {
  const session = await getSession();
  if (!session || !(hasPermission(session, "treso.decider_finance") || hasPermission(session, "treso.valider_demande"))) return NON_AUTORISE;

  const demande = await prisma.demande.findUnique({ where: { id: String(demandeId) }, select: { id: true, typeDemande: true, categorieId: true, statut: true } });
  if (!demande) return { status: "error", message: "Demande introuvable." };
  if (["REJETEE", "CLOTUREE", "ABANDONNEE"].includes(demande.statut)) return { status: "error", message: "Cette demande n'est plus modifiable." };

  let ajouts: AjoutBudget[];
  if (demande.typeDemande === "DEPENSE_DIRECTE") {
    const montant = Number(montantDepenseDirecte);
    if (!Number.isFinite(montant) || montant <= 0) return { status: "error", message: "Montant invalide." };
    ajouts = [{ categorieId: demande.categorieId, montant }];
  } else {
    ajouts = await ajoutsPourArticles(prisma, demande.id, Array.isArray(ligneIds) ? ligneIds.map(String) : []);
    if (ajouts.length === 0) return { status: "error", message: "Aucun article à valider dans cette sélection." };
  }

  const r = await demanderConfirmationDepassement(demande.id, ajouts, session.user.id);
  if (!r.ok) return { status: "error", message: r.message };
  await notifierDemandeConfirmationDepassement(demande.id, r.reference, r.resume, session.user.id);
  rafraichir(demande.id);
  return { status: "success", message: "Confirmation demandée au DG : vous pourrez valider dès qu'il aura confirmé le dépassement." };
}

/** Le DG (seul) confirme un dépassement rouge demandé par la Finance, avec un motif obligatoire (10 caractères minimum). */
export async function confirmerDepassementBudgetAction(id: string, motif: string): Promise<ResultatBudgetAction> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.decider_dg")) return NON_AUTORISE;

  const r = await confirmerDepassementBudget(String(id), String(motif ?? ""), session.user.id);
  if (!r.ok) return { status: "error", message: r.message };
  await notifierConfirmationDepassement(r.demandeId, r.reference, r.demandeParId, String(motif).trim());
  rafraichir(r.demandeId);
  return { status: "success", message: "Dépassement confirmé : la Finance peut valider." };
}

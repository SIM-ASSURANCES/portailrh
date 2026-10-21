"use server";

import { revalidatePath } from "next/cache";

import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import {
  notifierConfirmationDepassement,
  notifierDecisionParametrages,
  notifierDemandeConfirmationDepassement,
  notifierParametragesSoumis,
} from "@/lib/notificationsBudget";
import {
  ajoutsPourArticles,
  confirmerDepassementBudget,
  demanderConfirmationDepassement,
  deciderParametragesBudget,
  prisma,
  soumettreParametragesBudget,
  type AjoutBudget,
  type SaisieParametrage,
} from "backend";
import { avecSignature } from "@/lib/signature";

/**
 * Actions des budgets (lot J, 2026-10-19 ; lot J ter, 2026-10-20 ; lot J quater : une action de soumission et une de décision PAR section). Chaque action revérifie sa permission ici, jamais seulement le masquage d'un bouton :
 *   - paramétrer (soumettre au DG, seul ou en lot) : `treso.modifier_budget_categorie` (la Finance) ;
 *   - valider / refuser des paramétrages (seul ou en lot) : `treso.valider_budget` (le DG), jamais le compte qui les a soumis ;
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

type PorteeBudget = "GLOBAL" | "CATEGORIE";

/**
 * Saisie reçue du client, recopiée champ par champ (jamais l'objet reçu tel quel). La PORTÉE n'est jamais lue de l'objet reçu : elle est
 * imposée par l'action appelée (section « Budget de caisse » ou « Budgets par catégorie »), qui ne peut donc pas être détournée pour
 * écrire dans l'autre.
 */
function saisieRecue(s: unknown, portee: PorteeBudget): SaisieParametrage | null {
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  const seuil = o.seuil && typeof o.seuil === "object" ? (o.seuil as Record<string, unknown>) : null;
  return {
    portee,
    // Le budget de caisse n'a ni catégorie ni montant (c'est le solde de caisse réel) : jamais transmis au serveur de calcul.
    categorieId: portee === "GLOBAL" ? null : typeof o.categorieId === "string" && o.categorieId ? o.categorieId : null,
    montant: portee === "GLOBAL" ? null : Number(o.montant),
    dateDebut: String(o.dateDebut ?? ""),
    dateFin: typeof o.dateFin === "string" && o.dateFin ? o.dateFin : null,
    seuil: seuil
      ? { mode: seuil.mode === "MONTANT" ? "MONTANT" : seuil.mode === "POURCENTAGE" ? "POURCENTAGE" : ("" as never), orange: Number(seuil.orange), rouge: Number(seuil.rouge) }
      : null,
  };
}

export interface ResultatSoumissionBudgetAction extends ResultatBudgetAction {
  /** Erreurs de champ par position dans la sélection soumise. */
  erreursParIndex?: Record<number, Record<string, string>>;
}

/**
 * Soumission d'une section (lot J quater : une action PAR section). La Finance soumet au DG un ou plusieurs paramétrages de LA section ;
 * tout ou rien ; sans effet tant que le DG n'a pas validé ; UNE seule notification pour tout le lot, propre à la section.
 */
async function soumettreSection(saisies: unknown, portee: PorteeBudget): Promise<ResultatSoumissionBudgetAction> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.modifier_budget_categorie")) return NON_AUTORISE;
  if (!Array.isArray(saisies) || saisies.length === 0 || saisies.length > 200) return { status: "error", message: portee === "GLOBAL" ? "Renseignez les seuils à soumettre." : "Cochez au moins un budget à soumettre." };
  const recues = saisies.map((s) => saisieRecue(s, portee));
  if (recues.some((x) => x === null)) return { status: "error", message: "Saisie invalide." };
  if (portee === "GLOBAL" && recues.length !== 1) return { status: "error", message: "Les seuils du budget de caisse se soumettent en un seul paramétrage." };
  if (portee === "CATEGORIE" && recues.some((x) => !x?.categorieId)) return { status: "error", message: "Choisissez une catégorie pour chaque budget." };

  const r = await soumettreParametragesBudget(recues as SaisieParametrage[], session.user.id);
  if (!r.ok) return { status: "error", message: r.message, erreursParIndex: r.erreursParIndex };

  await notifierParametragesSoumis(session.user.id, r.ids.length, r.resume, portee);
  rafraichir();
  return {
    status: "success",
    message:
      portee === "GLOBAL"
        ? "Seuils de caisse soumis au DG : ils ne seront pris en compte qu'une fois validés."
        : r.ids.length === 1
          ? "Budget de catégorie soumis au DG : il ne sera pris en compte qu'une fois validé."
          : `${r.ids.length} budgets de catégorie soumis au DG : ils ne seront pris en compte qu'une fois validés.`,
  };
}

/** Section « Budget de caisse » : la Finance soumet au DG les SEUILS du solde de caisse (en FCFA, avec date d'effet). Jamais de montant. */
export async function soumettreSeuilsCaisseAction(saisie: SaisieParametrage): Promise<ResultatSoumissionBudgetAction> {
  return avecSignature({ action: "budget_soumission_caisse", permission: "treso.modifier_budget_categorie", entite: "BudgetParametrage" }, () => soumettreSeuilsCaisseInterne(saisie));
}

async function soumettreSeuilsCaisseInterne(saisie: SaisieParametrage): Promise<ResultatSoumissionBudgetAction> {
  return soumettreSection([saisie], "GLOBAL");
}

/** Section « Budgets par catégorie » : la Finance soumet au DG un ou plusieurs budgets de catégorie (montant, seuils, date d'effet). Tout ou rien. */
export async function soumettreBudgetsCategoriesAction(saisies: SaisieParametrage[]): Promise<ResultatSoumissionBudgetAction> {
  return avecSignature({ action: "budget_soumission_categories", permission: "treso.modifier_budget_categorie", entite: "BudgetParametrage" }, () => soumettreBudgetsCategoriesInterne(saisies));
}

async function soumettreBudgetsCategoriesInterne(saisies: SaisieParametrage[]): Promise<ResultatSoumissionBudgetAction> {
  return soumettreSection(saisies, "CATEGORIE");
}

/**
 * Décision d'une section (lot J quater : une action PAR section). Le DG valide ou refuse un ou plusieurs paramétrages (motif obligatoire
 * au refus, propre à chaque élément ou commun). Chaque élément garde sa propre trace ; ce que le DG a lui-même soumis est ignoré ;
 * UNE seule notification par soumetteur. La portée de CHAQUE identifiant est revérifiée en base : une action de section ne peut pas
 * décider un paramétrage de l'autre section.
 */
async function deciderSection(
  portee: PorteeBudget,
  elements: { id: string; motif?: string }[],
  valider: boolean,
  motifCommun?: string
): Promise<ResultatBudgetAction & { ignores?: string[] }> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.valider_budget")) return NON_AUTORISE;
  if (!Array.isArray(elements) || elements.length === 0 || elements.length > 200) return { status: "error", message: "Cochez au moins un paramétrage." };
  const ids = elements.map((e) => String(e?.id ?? ""));
  const trouves = await prisma.budgetParametrage.findMany({ where: { id: { in: ids } }, select: { id: true, portee: true } });
  if (trouves.some((t) => t.portee !== portee)) {
    return { status: "error", message: portee === "GLOBAL" ? "Cette action ne décide que les seuils du budget de caisse." : "Cette action ne décide que les budgets de catégorie." };
  }

  const r = await deciderParametragesBudget(
    elements.map((e) => ({ id: String(e?.id ?? ""), motif: e?.motif === undefined ? null : String(e.motif) })),
    valider === true,
    motifCommun === undefined ? null : String(motifCommun),
    session.user.id
  );
  if (!r.ok) return { status: "error", message: r.message };

  await notifierDecisionParametrages(r.decides, valider === true, portee);
  rafraichir();
  const n = r.decides.length;
  const ignores = r.ignores.map((i) => i.message);
  const base =
    portee === "GLOBAL"
      ? valider === true
        ? "Seuils de caisse validés : ils s'appliquent à leur date d'effet."
        : "Seuils de caisse refusés : la Finance en est informée."
      : valider === true
        ? n === 1 ? "Budget de catégorie validé : il s'applique à sa date d'effet." : `${n} budgets de catégorie validés : ils s'appliquent à leur date d'effet.`
        : n === 1 ? "Budget de catégorie refusé : la Finance en est informée." : `${n} budgets de catégorie refusés : la Finance en est informée.`;
  return { status: "success", message: ignores.length > 0 ? `${base} Non décidés : ${ignores.join(" ")}` : base, ignores };
}

/** Section « Budget de caisse » : le DG valide ou refuse des seuils de caisse (seul, ou en lot si plusieurs ont été soumis). */
export async function deciderSeuilsCaisseAction(elements: { id: string; motif?: string }[], valider: boolean, motifCommun?: string) {
  return avecSignature({ action: "budget_decision_caisse", permission: "treso.valider_budget", entite: "BudgetParametrage" }, () => deciderSeuilsCaisseInterne(elements, valider, motifCommun));
}

async function deciderSeuilsCaisseInterne(elements: { id: string; motif?: string }[], valider: boolean, motifCommun?: string) {
  return deciderSection("GLOBAL", elements, valider, motifCommun);
}

/** Section « Budgets par catégorie » : le DG valide ou refuse des budgets de catégorie, seul ou en lot. */
export async function deciderBudgetsCategoriesAction(elements: { id: string; motif?: string }[], valider: boolean, motifCommun?: string) {
  return avecSignature({ action: "budget_decision_categories", permission: "treso.valider_budget", entite: "BudgetParametrage" }, () => deciderBudgetsCategoriesInterne(elements, valider, motifCommun));
}

async function deciderBudgetsCategoriesInterne(elements: { id: string; motif?: string }[], valider: boolean, motifCommun?: string) {
  return deciderSection("CATEGORIE", elements, valider, motifCommun);
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
  return avecSignature({ action: "confirmation_depassement_budget", permission: "treso.decider_dg", entite: "BudgetDepassement", entiteId: id }, () => confirmerDepassementBudgetInterne(id, motif));
}

async function confirmerDepassementBudgetInterne(id: string, motif: string): Promise<ResultatBudgetAction> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.decider_dg")) return NON_AUTORISE;

  const r = await confirmerDepassementBudget(String(id), String(motif ?? ""), session.user.id);
  if (!r.ok) return { status: "error", message: r.message };
  await notifierConfirmationDepassement(r.demandeId, r.reference, r.demandeParId, String(motif).trim());
  rafraichir(r.demandeId);
  return { status: "success", message: "Dépassement confirmé : la Finance peut valider." };
}

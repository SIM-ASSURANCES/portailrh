"use server";

// Circuit de validation des demandes (commit 3, 2026-10-06) : actions des étapes qui n'avaient pas d'action
// existante. Le moteur (`backend/src/circuitDemande.ts`) décide qui peut agir à l'étape courante ; chaque action
// revérifie tout côté serveur, quel que soit l'affichage. Après chaque passage d'étape, ceux qui doivent agir sont
// notifiés (`notifierEtapeCircuit`, commit 5). Rejet vers le demandeur : `rejeterDemandeAction` (espace Finance),
// commune à tous les niveaux.

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { notifierAlerteBudget } from "@/lib/notificationsBudget";
import { notifierEtapeCircuit, notifierRefusLigneDG, notifierReorientation, notifierReprise } from "@/lib/notificationsCircuit";
import {
  appliquerTransitionCircuit,
  calculerStatutDemande,
  reorienterEtapeService,
  reprendreEtape,
  chargerActeur,
  corrigerEtResoumettre,
  deciderLigneDG,
  prisma,
  soumettreLignesAuDG,
  type ActionCircuit,
  type ChoixBeneficiaire,
  type CorrectionDemande,
  type PrevisionBudget,
} from "backend";

import { rejeterDemandeAction } from "../finance/demandes/[id]/actions";
import { avecSignature } from "@/lib/signature";

type Resultat = { status: "success"; message: string } | { status: "error"; message: string };

function rafraichir(demandeId: string) {
  revalidatePath(`/treso/demandes/${demandeId}`);
  revalidatePath(`/treso/finance/demandes/${demandeId}`);
  revalidatePath("/treso/finance/demandes");
  revalidatePath("/treso/demandes");
  revalidatePath("/treso/service");
  revalidatePath("/treso/dg");
  revalidatePath(`/treso/dg/${demandeId}`);
  revalidatePath(`/treso/service/${demandeId}`);
  revalidatePath("/", "layout");
  publishDataChanged();
}

async function agir(
  demandeId: string,
  action: Exclude<
    ActionCircuit,
    { type: "RESOUMETTRE_CORRECTION" | "DECIDER_LIGNES" | "REJETER" | "SOUMETTRE_LIGNES_DG" | "DECIDER_LIGNE_DG" }
  >,
  succes: (reference: string) => string
): Promise<Resultat> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Action non autorisée." };
  const demande = await prisma.demande.findUnique({ where: { id: demandeId }, select: { createurId: true, reference: true } });
  if (!demande) return { status: "error", message: "Demande introuvable." };

  const acteur = await chargerActeur(prisma, session, demande.createurId);
  const r = await prisma.$transaction((tx) => appliquerTransitionCircuit(tx, demandeId, acteur, action));
  if (!r.ok) return { status: "error", message: r.message };
  rafraichir(demandeId);
  await notifierEtapeCircuit(demandeId, session.user.id);
  return { status: "success", message: succes(demande.reference) };
}

/** Étape Service : le responsable du service du demandeur valide. */
export async function validerEtapeServiceAction(demandeId: string): Promise<Resultat> {
  return avecSignature({ action: "validation_service", cible: { type: "demande", id: demandeId } }, () => validerEtapeServiceInterne(demandeId));
}

async function validerEtapeServiceInterne(demandeId: string): Promise<Resultat> {
  return agir(demandeId, { type: "VALIDER_SERVICE" }, (ref) => `Demande ${ref} validée pour le service.`);
}

/**
 * Étape Service : le responsable rejette (motif obligatoire, 3 caractères minimum) ; la demande part en correction.
 * Même action que tout rejet vers le demandeur (moteur, historique, notification), plus le rafraîchissement des
 * écrans du responsable.
 */
export async function rejeterEtapeServiceAction(demandeId: string, motif: string): Promise<Resultat> {
  return avecSignature({ action: "rejet_service", cible: { type: "demande", id: demandeId } }, () => rejeterEtapeServiceInterne(demandeId, motif));
}

async function rejeterEtapeServiceInterne(demandeId: string, motif: string): Promise<Resultat> {
  const r = await rejeterDemandeAction(demandeId, motif ?? "");
  if (r.status === "success") rafraichir(demandeId);
  return { status: r.status === "success" ? "success" : "error", message: r.message ?? "" };
}

/**
 * Étape DG, cas b (demande de la Finance) : le DG rejette la demande entière (motif obligatoire) ; elle part en
 * correction. Même action que tout rejet vers le demandeur, plus le rafraîchissement des écrans du DG.
 */
export async function rejeterDemandeEtapeDGAction(demandeId: string, motif: string): Promise<Resultat> {
  return avecSignature({ action: "rejet_demande_dg", permission: "treso.decider_dg", cible: { type: "demande", id: demandeId } }, () => rejeterDemandeEtapeDGInterne(demandeId, motif));
}

async function rejeterDemandeEtapeDGInterne(demandeId: string, motif: string): Promise<Resultat> {
  const r = await rejeterDemandeAction(demandeId, motif ?? "");
  if (r.status === "success") rafraichir(demandeId);
  return { status: r.status === "success" ? "success" : "error", message: r.message ?? "" };
}

/** Étape Finance : soumission au DG (avant toute décision ligne par ligne). */
export async function soumettreAuDGAction(demandeId: string): Promise<Resultat> {
  return avecSignature({ action: "soumission_dg", permission: "treso.soumettre_dg", cible: { type: "demande", id: demandeId } }, () => soumettreAuDGInterne(demandeId));
}

async function soumettreAuDGInterne(demandeId: string): Promise<Resultat> {
  return agir(demandeId, { type: "SOUMETTRE_DG" }, (ref) => `Demande ${ref} soumise au DG.`);
}

/** Refus du moteur levé DANS la transaction pour l'annuler entièrement (aucune écriture partielle). */
class RefusTransaction extends Error {}

/**
 * Étape Finance (ou décision finale, ou pendant que le DG décide) : la Finance soumet au DG les lignes choisies, ou lui
 * resoumet des lignes qu'il a refusées (2026-10-10, `treso.soumettre_dg`). Le DG est notifié.
 */
export async function soumettreLignesAuDGAction(demandeId: string, ligneIds: string[]): Promise<Resultat> {
  return avecSignature({ action: "soumission_lignes_dg", permission: "treso.soumettre_dg", cible: { type: "demande", id: demandeId } }, () => soumettreLignesAuDGInterne(demandeId, ligneIds));
}

async function soumettreLignesAuDGInterne(demandeId: string, ligneIds: string[]): Promise<Resultat> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Action non autorisée." };
  const demande = await prisma.demande.findUnique({ where: { id: demandeId }, select: { createurId: true, reference: true } });
  if (!demande) return { status: "error", message: "Demande introuvable." };
  const ids = Array.isArray(ligneIds) ? ligneIds.map(String) : [];

  const acteur = await chargerActeur(prisma, session, demande.createurId);
  let nombre = 0;
  let resoumisIds: string[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      const r = await soumettreLignesAuDG(tx, demandeId, acteur, ids);
      if (!r.ok) throw new RefusTransaction(r.message);
      nombre = r.libelles?.length ?? 0;
      resoumisIds = r.resoumisIds ?? [];
    });
  } catch (e) {
    if (e instanceof RefusTransaction) return { status: "error", message: e.message };
    throw e;
  }
  rafraichir(demandeId);
  await notifierEtapeCircuit(demandeId, session.user.id, "SOUMISSION_DG", { ligneIds: ids, resoumisIds });
  return {
    status: "success",
    message: `${nombre} ligne${nombre > 1 ? "s" : ""} de la demande ${demande.reference} soumise${nombre > 1 ? "s" : ""} au DG.`,
  };
}

/**
 * Étape DG : le DG décide UNE ligne soumise — validée, ou refusée avec motif (elle revient à la Finance, prévenue).
 * La dernière ligne décidée rend la main à la Finance pour la décision finale.
 */
export async function deciderLigneDGAction(ligneId: string, valider: boolean, motif?: string, motifDepassement?: string): Promise<Resultat> {
  return avecSignature({ action: "decision_ligne_dg", permission: "treso.decider_dg", cible: { type: "ligne", id: ligneId } }, () => deciderLigneDGInterne(ligneId, valider, motif, motifDepassement));
}

async function deciderLigneDGInterne(ligneId: string, valider: boolean, motif?: string, motifDepassement?: string): Promise<Resultat> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Action non autorisée." };
  const ligne = await prisma.ligneDemande.findUnique({
    where: { id: String(ligneId) },
    select: { demandeId: true, demande: { select: { createurId: true, reference: true } } },
  });
  if (!ligne) return { status: "error", message: "Ligne introuvable." };

  const acteur = await chargerActeur(prisma, session, ligne.demande.createurId);
  const decision = {
    valider: valider === true,
    motif: motif === undefined ? undefined : String(motif),
    // Lot J : le DG confirme, dans ce geste, le dépassement du seuil rouge d'un budget (motif obligatoire).
    motifDepassement: motifDepassement === undefined ? null : String(motifDepassement),
  };
  let resultat: { etapeSuivante: string; libelle: string; budget?: PrevisionBudget } = { etapeSuivante: "DG", libelle: "" };
  try {
    await prisma.$transaction(async (tx) => {
      const r = await deciderLigneDG(tx, String(ligneId), acteur, decision);
      if (!r.ok) throw new RefusTransaction(r.message);
      resultat = { etapeSuivante: r.etapeSuivante, libelle: r.libelle ?? "", budget: r.budget };
    });
  } catch (e) {
    if (e instanceof RefusTransaction) return { status: "error", message: e.message };
    throw e;
  }
  rafraichir(ligne.demandeId);
  // Lot J : alerte orange (ou rouge confirmé par le DG) → Finance et DG prévenus.
  if (resultat.budget) await notifierAlerteBudget(ligne.demandeId, session.user.id, resultat.budget);
  // Lot B : l'étape ne dit plus si le DG a fini — on compte les articles qui l'attendent encore.
  const resteChezLeDG = await prisma.ligneDemande.count({
    where: { demandeId: ligne.demandeId, statutValidation: "EN_ATTENTE", soumiseAuDG: true, decisionDG: null },
  });
  if (resteChezLeDG === 0) {
    await notifierEtapeCircuit(ligne.demandeId, session.user.id, "DECISION_DG", { ligneIds: [String(ligneId)] });
  } else if (!decision.valider) {
    await notifierRefusLigneDG(ligne.demandeId, session.user.id, {
      libelle: resultat.libelle,
      motif: (decision.motif ?? "").trim(),
      ligneId: String(ligneId),
    });
  }
  return {
    status: "success",
    message:
      `Ligne « ${resultat.libelle} » ${decision.valider ? "validée" : "refusée"}.` +
      (resteChezLeDG === 0 ? " Toutes les lignes soumises sont décidées : la Finance reprend la main." : ""),
  };
}

/** Après un rejet du DG : la Finance resoumet au DG. */
export async function resoumettreAuDGAction(demandeId: string): Promise<Resultat> {
  return avecSignature({ action: "resoumission_dg", permission: "treso.soumettre_dg", cible: { type: "demande", id: demandeId } }, () => resoumettreAuDGInterne(demandeId));
}

async function resoumettreAuDGInterne(demandeId: string): Promise<Resultat> {
  return agir(demandeId, { type: "RESOUMETTRE_DG" }, (ref) => `Demande ${ref} resoumise au DG.`);
}

/** Étape DG : le DG valide la demande entière (vaut son approbation de clôture) ; la Finance décide ensuite. */
export async function validerEtapeDGAction(demandeId: string): Promise<Resultat> {
  return avecSignature({ action: "validation_dg", permission: "treso.decider_dg", cible: { type: "demande", id: demandeId } }, () => validerEtapeDGInterne(demandeId));
}

async function validerEtapeDGInterne(demandeId: string): Promise<Resultat> {
  return agir(demandeId, { type: "VALIDER_DG" }, (ref) => `Demande ${ref} validée par le DG : décision finale à la Finance.`);
}

/** Étape DG : le DG rejette, la demande revient à la Finance avec son motif. */
export async function rejeterEtapeDGAction(demandeId: string, motif: string): Promise<Resultat> {
  return avecSignature({ action: "rejet_dg", permission: "treso.decider_dg", cible: { type: "demande", id: demandeId } }, () => rejeterEtapeDGInterne(demandeId, motif));
}

async function rejeterEtapeDGInterne(demandeId: string, motif: string): Promise<Resultat> {
  return agir(demandeId, { type: "REJETER_DG", motif: motif ?? "" }, (ref) => `Demande ${ref} rejetée par le DG : retour à la Finance.`);
}

/** « À corriger » : le demandeur abandonne sa demande (état final). */
export async function abandonnerDemandeAction(demandeId: string): Promise<Resultat> {
  return agir(demandeId, { type: "ABANDONNER" }, (ref) => `Demande ${ref} abandonnée.`);
}

/** Choix de bénéficiaire reçu du client, recopié champ par champ (jamais l'objet reçu tel quel). */
function choixRecu(c: unknown): ChoixBeneficiaire | null | undefined {
  if (c === undefined) return undefined;
  if (c === null || typeof c !== "object") return null;
  const v = c as { mode?: unknown; userId?: unknown; nom?: unknown };
  if (v.mode === "COMPTE") return { mode: "COMPTE", userId: String(v.userId ?? "") };
  if (v.mode === "NOM") return { mode: "NOM", nom: String(v.nom ?? "") };
  return { mode: "MOI" };
}

/** « À corriger » : le demandeur corrige (lignes, montants, motif, pièce jointe) et resoumet. */
export async function corrigerEtResoumettreDemandeAction(
  demandeId: string,
  correction: CorrectionDemande
): Promise<Resultat> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Action non autorisée." };
  const demande = await prisma.demande.findUnique({ where: { id: demandeId }, select: { reference: true } });
  if (!demande) return { status: "error", message: "Demande introuvable." };

  const lignes = Array.isArray(correction?.lignes) ? correction.lignes : [];
  const r = await prisma.$transaction((tx) =>
    corrigerEtResoumettre(tx, demandeId, session.user.id, {
      description: correction?.description === undefined ? undefined : String(correction.description),
      lignes: lignes.map((l) => ({
        id: l.id ? String(l.id) : undefined,
        libelle: String(l.libelle ?? ""),
        motif: String(l.motif ?? ""),
        quantite: Number(l.quantite),
        prixUnitaire: Number(l.prixUnitaire),
        // Autonomie des articles, lot A : bénéficiaire et pièces propres à l'article (revalidés par le moteur).
        beneficiaire: choixRecu(l.beneficiaire),
        pieceJointeUrls: Array.isArray(l.pieceJointeUrls) ? l.pieceJointeUrls.map(String) : undefined,
        // Lot G : date de livraison de l'article (absente = inchangée ; chaîne vide = effacée).
        dateLivraison: l.dateLivraison === undefined || l.dateLivraison === null ? undefined : String(l.dateLivraison),
      })),
      pieceJointeUrl: correction?.pieceJointeUrl ? String(correction.pieceJointeUrl) : undefined,
    })
  );
  if (!r.ok) return { status: "error", message: r.message };
  rafraichir(demandeId);
  await notifierEtapeCircuit(demandeId, session.user.id);
  return { status: "success", message: `Demande ${demande.reference} corrigée et resoumise.` };
}

/**
 * Lot K — réorientation de l'étape Service : le demandeur, ou la Finance (`treso.reorienter_demande`), confie la validation du
 * responsable de service à un AUTRE responsable disponible. Motif obligatoire (10 caractères). Le moteur et la cible sont
 * revérifiés côté serveur (étape, permission, compte actif, absent, garde 8) ; l'ancien responsable ne peut plus décider.
 */
export async function reorienterDemandeAction(demandeId: string, cibleId: string, motif: string): Promise<Resultat> {
  return avecSignature({ action: "reorientation_service", permission: "treso.reorienter_demande", cible: { type: "demande", id: demandeId } }, () => reorienterDemandeInterne(demandeId, cibleId, motif));
}

async function reorienterDemandeInterne(demandeId: string, cibleId: string, motif: string): Promise<Resultat> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Action non autorisée." };
  const demande = await prisma.demande.findUnique({ where: { id: String(demandeId) }, select: { createurId: true, reference: true } });
  if (!demande) return { status: "error", message: "Demande introuvable." };

  const acteur = await chargerActeur(prisma, session, demande.createurId, String(demandeId));
  let resultat: Extract<Awaited<ReturnType<typeof reorienterEtapeService>>, { ok: true }>;
  try {
    resultat = await prisma.$transaction(async (tx) => {
      const r = await reorienterEtapeService(tx, String(demandeId), acteur, String(cibleId ?? ""), String(motif ?? ""));
      if (!r.ok) throw new RefusTransaction(r.message);
      return r;
    });
  } catch (e) {
    if (e instanceof RefusTransaction) return { status: "error", message: e.message };
    throw e;
  }
  rafraichir(String(demandeId));
  await notifierReorientation(String(demandeId), {
    acteurId: session.user.id,
    ancienId: resultat.de.id,
    nouveauId: resultat.vers.id,
    ancienNom: resultat.de.nom,
    nouveauNom: resultat.vers.nom,
    motif: String(motif).trim(),
    delai: resultat.delai,
  });
  return { status: "success", message: `Demande ${demande.reference} réorientée vers ${resultat.vers.nom}.` };
}

/**
 * Lot K — reprise : la demande entière (`ligneId` absent : Finance → Service) ou un article (DG → Finance ; validation de la
 * Finance → à décider) revient à l'étape précédente, motif obligatoire (10 caractères). Jamais un article réglé, rejeté, validé par
 * le DG, ni une demande clôturée : le moteur refuse, la transaction est annulée en entier. Aucune écriture de caisse.
 */
export async function reprendreEtapeAction(demandeId: string, ligneId: string | null, motif: string): Promise<Resultat> {
  return avecSignature({ action: "reprise_etape", permission: "treso.decider_finance", cible: { type: "demande", id: demandeId } }, () => reprendreEtapeInterne(demandeId, ligneId, motif));
}

async function reprendreEtapeInterne(demandeId: string, ligneId: string | null, motif: string): Promise<Resultat> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Action non autorisée." };
  const demande = await prisma.demande.findUnique({ where: { id: String(demandeId) }, select: { createurId: true, reference: true } });
  if (!demande) return { status: "error", message: "Demande introuvable." };

  const acteur = await chargerActeur(prisma, session, demande.createurId, String(demandeId));
  let resultat: Extract<Awaited<ReturnType<typeof reprendreEtape>>, { ok: true }>;
  try {
    resultat = await prisma.$transaction(async (tx) => {
      const r = await reprendreEtape(tx, String(demandeId), acteur, ligneId ? String(ligneId) : undefined, String(motif ?? ""));
      if (!r.ok) throw new RefusTransaction(r.message);
      return r;
    });
  } catch (e) {
    if (e instanceof RefusTransaction) return { status: "error", message: e.message };
    throw e;
  }
  await calculerStatutDemande(String(demandeId));
  rafraichir(String(demandeId));
  await notifierReprise(String(demandeId), { acteurId: session.user.id, type: resultat.type, motif: String(motif).trim(), ligneId: resultat.ligneId, libelleArticle: resultat.libelleArticle });
  return {
    status: "success",
    message: resultat.libelleArticle
      ? `Article « ${resultat.libelleArticle} » de la demande ${demande.reference} repris à l'étape précédente.`
      : `Demande ${demande.reference} renvoyée au responsable de service.`,
  };
}

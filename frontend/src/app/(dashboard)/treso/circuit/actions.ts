"use server";

// Circuit de validation des demandes (commit 3, 2026-10-06) : actions des étapes qui n'avaient pas d'action
// existante. Le moteur (`backend/src/circuitDemande.ts`) décide qui peut agir à l'étape courante ; chaque action
// revérifie tout côté serveur, quel que soit l'affichage. Les écrans arrivent au commit 4, les notifications au
// commit 5. Rejet vers le demandeur : `rejeterDemandeAction` (espace Finance), commune à tous les niveaux.

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import {
  appliquerTransitionCircuit,
  chargerActeur,
  corrigerEtResoumettre,
  prisma,
  type ActionCircuit,
  type CorrectionDemande,
} from "backend";

import { rejeterDemandeAction } from "../finance/demandes/[id]/actions";

type Resultat = { status: "success"; message: string } | { status: "error"; message: string };

function rafraichir(demandeId: string) {
  revalidatePath(`/treso/demandes/${demandeId}`);
  revalidatePath(`/treso/finance/demandes/${demandeId}`);
  revalidatePath("/treso/finance/demandes");
  revalidatePath("/treso/demandes");
  revalidatePath("/treso/service");
  revalidatePath(`/treso/service/${demandeId}`);
  revalidatePath("/", "layout");
  publishDataChanged();
}

async function agir(
  demandeId: string,
  action: Exclude<ActionCircuit, { type: "RESOUMETTRE_CORRECTION" | "DECIDER_LIGNES" | "REJETER" }>,
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
  return { status: "success", message: succes(demande.reference) };
}

/** Étape Service : le responsable du service du demandeur valide. */
export async function validerEtapeServiceAction(demandeId: string): Promise<Resultat> {
  return agir(demandeId, { type: "VALIDER_SERVICE" }, (ref) => `Demande ${ref} validée pour le service.`);
}

/**
 * Étape Service : le responsable rejette (motif obligatoire, 3 caractères minimum) ; la demande part en correction.
 * Même action que tout rejet vers le demandeur (moteur, historique, notification), plus le rafraîchissement des
 * écrans du responsable.
 */
export async function rejeterEtapeServiceAction(demandeId: string, motif: string): Promise<Resultat> {
  const r = await rejeterDemandeAction(demandeId, motif ?? "");
  if (r.status === "success") rafraichir(demandeId);
  return { status: r.status === "success" ? "success" : "error", message: r.message ?? "" };
}

/** Étape Finance : soumission au DG (avant toute décision ligne par ligne). */
export async function soumettreAuDGAction(demandeId: string): Promise<Resultat> {
  return agir(demandeId, { type: "SOUMETTRE_DG" }, (ref) => `Demande ${ref} soumise au DG.`);
}

/** Après un rejet du DG : la Finance resoumet au DG. */
export async function resoumettreAuDGAction(demandeId: string): Promise<Resultat> {
  return agir(demandeId, { type: "RESOUMETTRE_DG" }, (ref) => `Demande ${ref} resoumise au DG.`);
}

/** Étape DG : le DG valide la demande entière (vaut son approbation de clôture) ; la Finance décide ensuite. */
export async function validerEtapeDGAction(demandeId: string): Promise<Resultat> {
  return agir(demandeId, { type: "VALIDER_DG" }, (ref) => `Demande ${ref} validée par le DG : décision finale à la Finance.`);
}

/** Étape DG : le DG rejette, la demande revient à la Finance avec son motif. */
export async function rejeterEtapeDGAction(demandeId: string, motif: string): Promise<Resultat> {
  return agir(demandeId, { type: "REJETER_DG", motif: motif ?? "" }, (ref) => `Demande ${ref} rejetée par le DG : retour à la Finance.`);
}

/** « À corriger » : le demandeur abandonne sa demande (état final). */
export async function abandonnerDemandeAction(demandeId: string): Promise<Resultat> {
  return agir(demandeId, { type: "ABANDONNER" }, (ref) => `Demande ${ref} abandonnée.`);
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
      description: String(correction?.description ?? ""),
      lignes: lignes.map((l) => ({
        id: l.id ? String(l.id) : undefined,
        libelle: String(l.libelle ?? ""),
        quantite: Number(l.quantite),
        prixUnitaire: Number(l.prixUnitaire),
      })),
      pieceJointeUrl: correction?.pieceJointeUrl ? String(correction.pieceJointeUrl) : undefined,
    })
  );
  if (!r.ok) return { status: "error", message: r.message };
  rafraichir(demandeId);
  return { status: "success", message: `Demande ${demande.reference} corrigée et resoumise.` };
}

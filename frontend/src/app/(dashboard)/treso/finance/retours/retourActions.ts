"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { prisma } from "backend";

type SimpleActionResult = { status: "success" | "error"; message: string };

/**
 * Réceptionne un retour de caisse déclaré par un collaborateur (Ticket 5).
 * Réservée à `treso.receptionner_retour`.
 *
 * **C'est l'unique moment où un retour de caisse impacte réellement le
 * solde de caisse** (règle impérative du cahier des charges) : la
 * déclaration seule (`creerRetourCaisseAction`, Ticket 5) ne touche jamais
 * `JournalCaisse`. Ici, la réception crée une écriture `ENTREE` de montant
 * `montantARetourner`, dans la **même transaction** que la mise à jour du
 * `RetourCaisse` (`estReceptionne`, `receptionneParId`, `receptionneAt`) et
 * la `HistoriqueEntry` — les trois réussissent ou échouent ensemble.
 *
 * Défense en profondeur : revérifie `estReceptionne` juste avant d'agir,
 * même si l'UI ne propose le bouton "Réceptionner" que sur les retours non
 * réceptionnés — un autre utilisateur Finance a pu réceptionner ce même
 * retour entre l'affichage de la liste et ce clic.
 *
* Défense en profondeur (Ticket 7, corrigée Phase C) : revérifie que la
 * demande n'est pas `CLOTUREE`. Une fois clôturée (précisément le cas d'un
 * retour resté en attente de réception au moment de la clôture), plus
 * aucune réception n'est possible — l'écart constaté est acté par le motif
 * de la clôture, pas rattrapable ensuite par une réception tardive.
 *
 * REFONTE V1 / Phase C : cette garde dépendait de `STATUTS_VALIDATION_COMPLETE`
 * (Phase B), donc bloquait à tort la réception d'un retour lié à un
 * règlement confirmé sur une demande seulement `PARTIELLEMENT_VALIDEE` —
 * or le règlement lui-même est désormais possible dans ce cas (cahier des
 * charges section 4). L'état pertinent ici est celui du RÈGLEMENT précis
 * (mode CAISSE, confirmé, non annulé — déjà garanti par
 * `creerRetourCaisseAction` avant qu'un `RetourCaisse` puisse exister), pas
 * le statut global de validation de la demande : seule la clôture doit
 * encore bloquer.
 */
export async function receptionnerRetourAction(retourId: string): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.receptionner_retour")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const retour = await prisma.retourCaisse.findUnique({
    where: { id: retourId },
    include: { reglement: { include: { demande: true } } },
  });

  if (!retour) {
    return { status: "error", message: "Retour de caisse introuvable." };
  }
  if (retour.estReceptionne) {
    return { status: "error", message: "Ce retour de caisse est déjà réceptionné." };
  }
  if (retour.reglement.demande.statut === "CLOTUREE") {
    return {
      status: "error",
      message: `Cette demande n'est plus modifiable (statut actuel : ${retour.reglement.demande.statut}).`,
    };
  }

  const demandeId = retour.reglement.demandeId;
  const montant = retour.montantARetourner;

  await prisma.$transaction([
    prisma.retourCaisse.update({
      where: { id: retourId },
      data: {
        estReceptionne: true,
        receptionneParId: session.user.id,
        receptionneAt: new Date(),
      },
    }),
    prisma.journalCaisse.create({
      data: {
        type: "ENTREE",
        montant,
        source: "retour_caisse_receptionne",
        refId: retourId,
        // Traçabilité (section 13) : la demande d'origine (via
        // Reglement -> Demande) et l'utilisateur qui réceptionne, identique
        // à `receptionneParId` sur le RetourCaisse mis à jour ci-dessus.
        demandeId,
        userId: session.user.id,
      },
    }),
    prisma.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: demandeId,
        action: "reception_retour",
        detail: `Retour de caisse réceptionné : ${Number(montant).toLocaleString("fr-FR")} FCFA`,
        userId: session.user.id,
      },
    }),
  ]);

  revalidatePath("/treso/finance/retours");
  revalidatePath(`/treso/demandes/${demandeId}`);
  revalidatePath(`/treso/finance/demandes/${demandeId}`);
  // Ticket 8 : la réception impacte le solde de caisse ET fait baisser le
  // compteur "Retours de caisse en attente" du dashboard Finance.
  revalidatePath("/treso/finance", "layout");
  publishDataChanged();

  return { status: "success", message: "Retour de caisse réceptionné." };
}

const motifNonJustifieSchema = z
  .string()
  .trim()
  .min(3, "Le motif est obligatoire (3 caractères minimum)");

/**
 * Finance marque une `DepenseLigne` d'un retour encore en attente comme
 * non justifiée, avec un motif obligatoire expliquant pourquoi Finance ne
 * la considère pas justifiée — voir CLAUDE.md "Motif Finance sur dépense
 * non justifiée". Réservée à `treso.receptionner_retour` (même permission
 * que le traitement/la réception du retour lui-même).
 *
 * Distinct de `DepenseLigne.commentaire` : ce dernier reste la
 * justification donnée par le COLLABORATEUR déclarant (déjà obligatoire de
 * son côté si `justification = SANS_PIECE` dès la déclaration,
 * `creerRetourCaisseAction`) — `motifNonJustifie` est la propre explication
 * de FINANCE, jamais réécrite par le collaborateur (aucune action
 * collaborateur ne touche ce champ). Applicable à une ligne QUELLE QUE SOIT
 * sa justification actuelle (y compris déjà `SANS_PIECE` déclarée par le
 * collaborateur — Finance peut alors simplement y ajouter son propre
 * motif) : force `justification: "SANS_PIECE"` dans tous les cas, pour que
 * la ligne apparaisse dans le suivi "Dépenses non justifiées"
 * (`depenses-non-justifiees/page.tsx`, indicateur #6 du dashboard Finance)
 * même si le collaborateur l'avait initialement déclarée avec pièce.
 *
 * Verrouillée dès que le retour est réceptionné — même principe que
 * `modifierRetourCaisseAction` : plus aucune correction possible après
 * réception, l'écart constaté à ce moment-là fait foi.
 */
export async function marquerDepenseNonJustifieeAction(
  depenseLigneId: string,
  motif: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.receptionner_retour")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsedMotif = motifNonJustifieSchema.safeParse(motif);
  if (!parsedMotif.success) {
    return { status: "error", message: parsedMotif.error.issues[0].message };
  }

  const ligne = await prisma.depenseLigne.findUnique({
    where: { id: depenseLigneId },
    include: { retourCaisse: { include: { reglement: { include: { demande: true } } } } },
  });

  if (!ligne) {
    return { status: "error", message: "Ligne de dépense introuvable." };
  }
  if (ligne.retourCaisse.estReceptionne) {
    return {
      status: "error",
      message: "Ce retour de caisse a déjà été réceptionné : ses lignes ne sont plus modifiables.",
    };
  }
  if (ligne.retourCaisse.reglement.demande.statut === "CLOTUREE") {
    return {
      status: "error",
      message: `Cette demande n'est plus modifiable (statut actuel : ${ligne.retourCaisse.reglement.demande.statut}).`,
    };
  }

  const demandeId = ligne.retourCaisse.reglement.demandeId;
  const ancienneJustification = ligne.justification;

  await prisma.$transaction([
    prisma.depenseLigne.update({
      where: { id: depenseLigneId },
      data: {
        justification: "SANS_PIECE",
        motifNonJustifie: parsedMotif.data,
        motifNonJustifieParId: session.user.id,
        motifNonJustifieAt: new Date(),
      },
    }),
    prisma.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: demandeId,
        action: "marquage_non_justifie",
        detail:
          ancienneJustification === "SANS_PIECE"
            ? `Dépense "${ligne.objet}" (${Number(ligne.montant).toLocaleString("fr-FR")} FCFA) confirmée non justifiée par Finance : ${parsedMotif.data}`
            : `Dépense "${ligne.objet}" (${Number(ligne.montant).toLocaleString("fr-FR")} FCFA) marquée non justifiée par Finance (était : ${ancienneJustification}) : ${parsedMotif.data}`,
        userId: session.user.id,
      },
    }),
  ]);

  revalidatePath("/treso/finance/retours");
  revalidatePath("/treso/finance/depenses-non-justifiees");
  revalidatePath(`/treso/demandes/${demandeId}`);
  revalidatePath(`/treso/finance/demandes/${demandeId}`);
  revalidatePath("/treso/finance", "layout");
  publishDataChanged();

  return { status: "success", message: "Dépense marquée non justifiée." };
}

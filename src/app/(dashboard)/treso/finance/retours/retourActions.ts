"use server";

import { revalidatePath } from "next/cache";

import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

  return { status: "success", message: "Retour de caisse réceptionné." };
}

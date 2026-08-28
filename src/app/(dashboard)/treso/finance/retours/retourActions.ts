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
 */
export async function receptionnerRetourAction(retourId: string): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.receptionner_retour")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const retour = await prisma.retourCaisse.findUnique({
    where: { id: retourId },
    include: { reglement: true },
  });

  if (!retour) {
    return { status: "error", message: "Retour de caisse introuvable." };
  }
  if (retour.estReceptionne) {
    return { status: "error", message: "Ce retour de caisse est déjà réceptionné." };
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

  return { status: "success", message: "Retour de caisse réceptionné." };
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { prisma } from "backend";

type SimpleActionResult = { status: "success" | "error"; message: string };

const RETOUR_EXTERNE_SOURCE = "retour_externe";

const schema = z.object({
  collaborateurId: z.string().trim().min(1).optional(),
  nomExterne: z.string().trim().min(2, "Le nom de la personne externe est trop court.").optional(),
  montantChequeInitial: z.coerce.number().positive("Le montant du chèque initial doit être supérieur à 0."),
  montantRetourne: z.coerce.number().positive("Le montant retourné doit être supérieur à 0."),
  motif: z.string().trim().min(10, "Le motif est obligatoire (10 caractères minimum)."),
  pieceJointeUrl: z.string().trim().min(1, "Le justificatif du retour est obligatoire."),
  pieceJointeChequeUrl: z.string().trim().min(1, "Le justificatif du chèque initial est obligatoire."),
});

/**
 * Retour EXTERNE (voir CLAUDE.md "Retour externe") : argent revenu en caisse
 * suite à un règlement fait hors système. Réservé au Responsable Finance
 * (`treso.valider_demande` ET PAS `treso.approuver_validation_complete`, même
 * garde que `validerLignesAction`). Écriture immédiate dans JournalCaisse,
 * sans statut "en attente" ni double validation.
 */
export async function creerRetourExterneAction(
  collaborateurId: string | undefined,
  nomExterne: string | undefined,
  montantChequeInitial: number,
  montantRetourne: number,
  motif: string,
  pieceJointeUrl: string,
  pieceJointeChequeUrl: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (
    !session ||
    !hasPermission(session, "treso.valider_demande") ||
    hasPermission(session, "treso.approuver_validation_complete")
  ) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsed = schema.safeParse({
    collaborateurId: collaborateurId || undefined,
    nomExterne: nomExterne || undefined,
    montantChequeInitial,
    montantRetourne,
    motif,
    pieceJointeUrl,
    pieceJointeChequeUrl,
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }
  const d = parsed.data;
  if (d.pieceJointeUrl === d.pieceJointeChequeUrl) {
    return { status: "error", message: "Les deux justificatifs (chèque initial et retour) doivent être deux fichiers distincts." };
  }
  if ((d.collaborateurId ? 1 : 0) + (d.nomExterne ? 1 : 0) !== 1) {
    return { status: "error", message: "Renseignez soit un collaborateur, soit un nom externe (jamais les deux ni aucun)." };
  }

  let personne = d.nomExterne ?? "";
  if (d.collaborateurId) {
    const user = await prisma.user.findUnique({ where: { id: d.collaborateurId } });
    if (!user) {
      return { status: "error", message: "Collaborateur introuvable." };
    }
    personne = user.fullName;
  }

  await prisma.$transaction(async (tx) => {
    const pj = await tx.pieceJointe.create({ data: { url: d.pieceJointeUrl } });
    const pjCheque = await tx.pieceJointe.create({ data: { url: d.pieceJointeChequeUrl } });
    const retour = await tx.retourExterne.create({
      data: {
        collaborateurId: d.collaborateurId ?? null,
        nomExterne: d.nomExterne ?? null,
        montantChequeInitial: d.montantChequeInitial,
        montantRetourne: d.montantRetourne,
        motif: d.motif,
        pieceJointeId: pj.id,
        pieceJointeChequeId: pjCheque.id,
        creeParId: session.user.id,
      },
    });
    await tx.journalCaisse.create({
      data: {
        type: "ENTREE",
        montant: d.montantRetourne,
        source: RETOUR_EXTERNE_SOURCE,
        refId: retour.id,
        userId: session.user.id,
      },
    });
    await tx.historiqueEntry.create({
      data: {
        entity: "RetourExterne",
        entityId: retour.id,
        action: "retour_externe",
        detail: `Retour externe de ${personne} : ${d.montantRetourne.toLocaleString("fr-FR")} FCFA retournés (chèque initial déclaré : ${d.montantChequeInitial.toLocaleString("fr-FR")} FCFA) — motif : ${d.motif} (justificatifs joints : chèque initial et retour).`,
        userId: session.user.id,
      },
    });
  });

  revalidatePath("/treso/finance", "layout");
  publishDataChanged();
  return {
    status: "success",
    message: `Retour externe de ${d.montantRetourne.toLocaleString("fr-FR")} FCFA enregistré : la caisse est créditée.`,
  };
}

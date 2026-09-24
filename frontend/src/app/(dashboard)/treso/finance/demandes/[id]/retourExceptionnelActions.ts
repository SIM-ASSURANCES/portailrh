"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { notify } from "@/lib/notifications";
import { getRetoursRecus, getTotalRegle, prisma } from "backend";

type SimpleActionResult = { status: "success" | "error"; message: string };

/**
 * Retour de caisse EXCEPTIONNEL post-clôture (voir CLAUDE.md "Retour de caisse
 * exceptionnel post-clôture") : saisie par l'Assistant Finance (ou le
 * Responsable), validation par le Responsable Finance UNIQUEMENT.
 *
 * Aucune écriture `JournalCaisse` avant validation : un retour en attente ou
 * rejeté n'affecte jamais `getSoldeCaisse()`.
 */

// Assistant Finance : `treso.receptionner_retour` (jamais un nom de rôle).
function estAssistantFinance(session: NonNullable<Awaited<ReturnType<typeof getSession>>>) {
  return hasPermission(session, "treso.receptionner_retour");
}

// Responsable Finance : même garde exacte que `validerLignesAction` —
// `treso.valider_demande` ET PAS `treso.approuver_validation_complete` (exclut le DG).
function estResponsableFinance(session: NonNullable<Awaited<ReturnType<typeof getSession>>>) {
  return hasPermission(session, "treso.valider_demande") && !hasPermission(session, "treso.approuver_validation_complete");
}

const saisieSchema = z.object({
  montant: z.coerce.number().positive("Le montant doit être supérieur à 0."),
  motif: z.string().trim().min(10, "Le motif est obligatoire (10 caractères minimum)."),
  pieceJointeUrl: z.string().trim().min(1).optional(),
});

function revalider(demandeId: string) {
  revalidatePath(`/treso/finance/demandes/${demandeId}`);
  revalidatePath(`/treso/demandes/${demandeId}`);
  revalidatePath("/treso/finance/retours-exceptionnels");
  revalidatePath("/treso/finance", "layout");
  publishDataChanged();
}

/** Saisie (Assistant Finance ou Responsable) — statut "en attente de validation". */
export async function creerRetourExceptionnelAction(
  demandeId: string,
  montant: number,
  motif: string,
  pieceJointeUrl?: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !estAssistantFinance(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsed = saisieSchema.safeParse({ montant, motif, pieceJointeUrl: pieceJointeUrl || undefined });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }

  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (demande.statut !== "CLOTUREE") {
    return { status: "error", message: "Un retour exceptionnel ne peut être enregistré que sur une demande clôturée." };
  }
  // Plafond : montant réglé (tous modes) − retours déjà reçus (normaux réceptionnés + exceptionnels validés).
  const [totalRegle, dejaRecu] = await Promise.all([getTotalRegle(demandeId), getRetoursRecus(demandeId)]);
  const plafond = Math.max(0, totalRegle - dejaRecu);
  if (Math.round(parsed.data.montant * 100) > Math.round(plafond * 100)) {
    return {
      status: "error",
      message: `Le montant dépasse le maximum autorisé (${plafond.toLocaleString("fr-FR")} FCFA = total réglé ${totalRegle.toLocaleString("fr-FR")} FCFA − retours déjà reçus ${dejaRecu.toLocaleString("fr-FR")} FCFA).`,
    };
  }
  const enAttente = await prisma.retourExceptionnel.count({ where: { demandeId, statut: "EN_ATTENTE_VALIDATION" } });
  if (enAttente > 0) {
    return {
      status: "error",
      message: "Un retour exceptionnel est déjà en attente de validation pour cette demande.",
    };
  }

  await prisma.$transaction(async (tx) => {
    const retour = await tx.retourExceptionnel.create({
      data: { demandeId, montant: parsed.data.montant, motif: parsed.data.motif, saisiParId: session.user.id },
    });
    if (parsed.data.pieceJointeUrl) {
      await tx.pieceJointe.create({ data: { url: parsed.data.pieceJointeUrl, demandeId, retourExceptionnelId: retour.id } });
    }
    await tx.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: demandeId,
        action: "retour_exceptionnel_saisie",
        detail: `Retour exceptionnel post-clôture saisi : ${parsed.data.montant.toLocaleString("fr-FR")} FCFA — motif : ${parsed.data.motif} (en attente de validation du Responsable Finance).`,
        userId: session.user.id,
      },
    });
  });

  revalider(demandeId);
  // Aucune notification au collaborateur à ce stade (évite une fausse alerte
  // si le Responsable rejette) — voir la spec.
  return { status: "success", message: "Retour exceptionnel enregistré — en attente de validation du Responsable Finance." };
}

/** Validation (Responsable Finance UNIQUEMENT, jamais l'auteur de la saisie). */
export async function validerRetourExceptionnelAction(retourId: string): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !estResponsableFinance(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  const retour = await prisma.retourExceptionnel.findUnique({
    where: { id: retourId },
    include: { demande: true, saisiPar: true },
  });
  if (!retour) {
    return { status: "error", message: "Retour exceptionnel introuvable." };
  }
  if (retour.statut !== "EN_ATTENTE_VALIDATION") {
    return { status: "error", message: "Ce retour exceptionnel a déjà été traité." };
  }
  if (retour.saisiParId === session.user.id) {
    return {
      status: "error",
      message: "Séparation des tâches : vous ne pouvez pas valider votre propre saisie.",
    };
  }

  const maintenant = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.retourExceptionnel.update({
      where: { id: retourId },
      data: { statut: "VALIDE", valideParId: session.user.id, valideAt: maintenant },
    });
    // Seule écriture dans le grand livre : ENTREE datée du jour de validation.
    await tx.journalCaisse.create({
      data: {
        type: "ENTREE",
        montant: retour.montant,
        source: "retour_exceptionnel_post_cloture",
        refId: retourId,
        demandeId: retour.demandeId,
        userId: session.user.id,
      },
    });
    await tx.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: retour.demandeId,
        action: "retour_exceptionnel_post_cloture",
        detail: `Retour exceptionnel post-clôture validé : ${Number(retour.montant).toLocaleString("fr-FR")} FCFA — motif : ${retour.motif}. Saisi par ${retour.saisiPar.fullName} le ${retour.saisiAt.toLocaleDateString("fr-FR")}, validé par ${session.user.fullName} le ${maintenant.toLocaleDateString("fr-FR")}.`,
        userId: session.user.id,
      },
    });
  });

  revalider(retour.demandeId);

  await notify({
    userId: retour.demande.createurId,
    titre: "Retour de caisse enregistré après clôture",
    message: `Un retour de ${Number(retour.montant).toLocaleString("fr-FR")} FCFA a été enregistré le ${maintenant.toLocaleDateString("fr-FR")} sur votre demande ${retour.demande.reference}.`,
    lien: `/treso/demandes/${retour.demandeId}`,
    priority: "IMPORTANT",
    category: "TRESORERIE",
  });

  return { status: "success", message: "Retour exceptionnel validé — écriture enregistrée en caisse." };
}

/** Rejet (Responsable Finance UNIQUEMENT), motif obligatoire. L'Assistant peut ensuite resaisir. */
export async function rejeterRetourExceptionnelAction(retourId: string, motifRejet: string): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !estResponsableFinance(session)) {
    return { status: "error", message: "Action non autorisée." };
  }
  const parsedMotif = z.string().trim().min(3, "Le motif de rejet est obligatoire (3 caractères minimum).").safeParse(motifRejet);
  if (!parsedMotif.success) {
    return { status: "error", message: parsedMotif.error.issues[0].message };
  }

  const retour = await prisma.retourExceptionnel.findUnique({ where: { id: retourId } });
  if (!retour) {
    return { status: "error", message: "Retour exceptionnel introuvable." };
  }
  if (retour.statut !== "EN_ATTENTE_VALIDATION") {
    return { status: "error", message: "Ce retour exceptionnel a déjà été traité." };
  }
  if (retour.saisiParId === session.user.id) {
    return { status: "error", message: "Séparation des tâches : vous ne pouvez pas traiter votre propre saisie." };
  }

  await prisma.$transaction([
    prisma.retourExceptionnel.update({
      where: { id: retourId },
      data: { statut: "REJETE", valideParId: session.user.id, valideAt: new Date(), motifRejet: parsedMotif.data },
    }),
    prisma.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: retour.demandeId,
        action: "retour_exceptionnel_rejete",
        detail: `Retour exceptionnel post-clôture rejeté (${Number(retour.montant).toLocaleString("fr-FR")} FCFA) — motif : ${parsedMotif.data}`,
        userId: session.user.id,
      },
    }),
  ]);

  revalider(retour.demandeId);
  return { status: "success", message: "Retour exceptionnel rejeté — l'Assistant Finance peut resaisir." };
}

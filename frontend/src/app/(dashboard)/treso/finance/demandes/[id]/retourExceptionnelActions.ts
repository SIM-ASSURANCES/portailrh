"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { notify } from "@/lib/notifications";
import { getDepensesDeclarees, getRetoursRecus, getTotalRegle, prisma } from "backend";

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

  // Part du montant qui COUVRE le solde à régulariser encore ouvert (ex. retour non réceptionné) : elle
  // ne réduit aucune dépense. Seul l'excédent réduit les dépenses non justifiées (solde ramené à 0, jamais négatif).
  const [totalRegle, depensesDeclarees, retoursRecus] = await Promise.all([
    getTotalRegle(retour.demandeId),
    getDepensesDeclarees(retour.demandeId),
    getRetoursRecus(retour.demandeId),
  ]);
  const ecartAvant = Math.round((totalRegle - depensesDeclarees - retoursRecus) * 100);
  const couvertureCentimes = Math.min(Math.round(Number(retour.montant) * 100), Math.max(0, ecartAvant));

  const maintenant = new Date();
  let residuel = 0;
  let resumeReduction = "";
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
    // Le montant rendu réduit en PRIORITÉ les dépenses "sans pièce formelle" (les moins vérifiées),
    // puis déborde sur le "non détaillé" — jamais sur les dépenses justifiées — pour que le Solde à
    // régulariser revienne à 0 au lieu de passer négatif.
    const lignes = await tx.depenseLigne.findMany({
      where: { retourCaisse: { reglement: { demandeId: retour.demandeId } }, justification: "SANS_PIECE" },
      orderBy: { createdAt: "asc" },
    });
    const sansPiece = lignes.filter((l) => l.motifNonJustifie != null);
    const nonDetaille = lignes.filter((l) => l.motifNonJustifie == null);
    let reste = Math.round(Number(retour.montant) * 100) - couvertureCentimes;
    let reduitSansPiece = 0;
    let reduitNonDetaille = 0;
    for (const [groupe, isSansPiece] of [[sansPiece, true], [nonDetaille, false]] as const) {
      for (const l of groupe) {
        if (reste <= 0) break;
        const m = Math.round(Number(l.montant) * 100);
        const retire = Math.min(m, reste);
        if (retire >= m) {
          await tx.depenseLigne.delete({ where: { id: l.id } });
        } else {
          await tx.depenseLigne.update({ where: { id: l.id }, data: { montant: (m - retire) / 100 } });
        }
        reste -= retire;
        if (isSansPiece) reduitSansPiece += retire;
        else reduitNonDetaille += retire;
      }
    }
    residuel = reste / 100;
    resumeReduction = `${couvertureCentimes > 0 ? ` ${(couvertureCentimes / 100).toLocaleString("fr-FR")} FCFA couvrent le solde encore à régulariser.` : ""} Dépenses réduites en conséquence : ${(reduitSansPiece / 100).toLocaleString("fr-FR")} FCFA sur « dépense sans pièce formelle »${
      reduitNonDetaille > 0 ? `, ${(reduitNonDetaille / 100).toLocaleString("fr-FR")} FCFA sur « non détaillé »` : ""
    }${
      residuel > 0 ? `. ATTENTION : ${residuel.toLocaleString("fr-FR")} FCFA n'ont pu être imputés (seules des dépenses justifiées subsistent) — le Solde à régulariser sera négatif, à vérifier.` : "."
    }`;
    await tx.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: retour.demandeId,
        action: "retour_exceptionnel_post_cloture",
        detail: `Retour exceptionnel post-clôture validé : ${Number(retour.montant).toLocaleString("fr-FR")} FCFA — motif : ${retour.motif}.${resumeReduction} Saisi par ${retour.saisiPar.fullName} le ${retour.saisiAt.toLocaleDateString("fr-FR")}, validé par ${session.user.fullName} le ${maintenant.toLocaleDateString("fr-FR")}.`,
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

  return {
    status: "success",
    message:
      residuel > 0
        ? `Retour exceptionnel validé — écriture enregistrée en caisse. Attention : ${residuel.toLocaleString("fr-FR")} FCFA n'ont pas pu être imputés sur les dépenses non justifiées (Solde à régulariser négatif).`
        : couvertureCentimes > 0
          ? `Retour exceptionnel validé — écriture enregistrée en caisse ; ${(couvertureCentimes / 100).toLocaleString("fr-FR")} FCFA couvrent le solde encore à régulariser${couvertureCentimes < Math.round(Number(retour.montant) * 100) ? ", le reste réduit les dépenses non justifiées" : ""}.`
          : "Retour exceptionnel validé — écriture enregistrée en caisse ; dépenses non justifiées réduites du même montant.",
  };
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

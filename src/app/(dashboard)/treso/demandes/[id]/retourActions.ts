"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fieldErrorsFromZod, type ActionState } from "@/lib/validation";

const retourSchema = z
  .object({
    reglementId: z.string().min(1),
    montantDepense: z.coerce.number().positive("Le montant dépensé doit être supérieur à 0"),
    montantARetourner: z.coerce
      .number()
      .min(0, "Le montant à retourner ne peut pas être négatif"),
    justification: z.enum(["FACTURE", "RECU", "TICKET", "SANS_PIECE"]),
    commentaire: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.justification === "SANS_PIECE" && !data.commentaire?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["commentaire"],
        message: "Le commentaire est obligatoire pour une dépense sans pièce formelle.",
      });
    }
  });

/**
 * Déclare un retour de caisse pour un règlement Caisse confirmé. Réservée
 * à `treso.declarer_retour`, et uniquement sur les propres demandes du
 * collaborateur connecté — jamais sur celles d'un tiers (revérifié ici,
 * pas seulement via la navigation/l'affichage de la page).
 *
 * V1 : un règlement ne peut recevoir qu'un seul retour déclaré à la fois
 * (évite les doublons) — revérifié ici même si le bouton de déclaration ne
 * devrait normalement plus être visible une fois un retour créé.
 *
 * RÈGLE CRITIQUE : cette action NE crée AUCUNE écriture `JournalCaisse` et
 * NE touche PAS au solde de caisse — seule la RÉCEPTION du retour par
 * Finance (Ticket 6, pas celui-ci) aura cet effet. Déclarer un retour
 * n'enregistre qu'une intention/justification côté collaborateur.
 *
 * Défense en profondeur (Ticket 7) : `reglement.demande.statut === "VALIDEE"`
 * est revérifiée ici — une fois la demande clôturée (`CLOTUREE_TOTALE` ou
 * `CLOTUREE_PARTIELLE`), plus aucun nouveau retour ne peut être déclaré,
 * même si le règlement d'origine reste `estConfirme` (ce champ ne change
 * jamais après clôture, ce n'était donc pas suffisant pour bloquer l'accès).
 */
export async function creerRetourCaisseAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.declarer_retour")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsed = retourSchema.safeParse({
    reglementId: formData.get("reglementId"),
    montantDepense: formData.get("montantDepense"),
    montantARetourner: formData.get("montantARetourner"),
    justification: formData.get("justification"),
    commentaire: formData.get("commentaire") || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const { reglementId, montantDepense, montantARetourner, justification, commentaire } = parsed.data;

  const reglement = await prisma.reglement.findUnique({
    where: { id: reglementId },
    include: { demande: true, retours: true },
  });

  if (!reglement) {
    return { status: "error", message: "Règlement introuvable." };
  }
  if (reglement.mode !== "CAISSE" || !reglement.estConfirme || reglement.estAnnule) {
    return { status: "error", message: "Ce règlement n'est pas éligible à un retour de caisse." };
  }
  if (reglement.demande.statut !== "VALIDEE") {
    return {
      status: "error",
      message: `Cette demande n'est plus modifiable (statut actuel : ${reglement.demande.statut}).`,
    };
  }
  if (reglement.demande.createurId !== session.user.id) {
    return { status: "error", message: "Vous ne pouvez déclarer un retour que sur vos propres demandes." };
  }
  if (reglement.retours.length > 0) {
    return { status: "error", message: "Un retour a déjà été déclaré pour ce règlement." };
  }

  await prisma.retourCaisse.create({
    data: {
      montantDepense,
      montantARetourner,
      justification,
      commentaire: commentaire || null,
      reglementId,
      declarantId: session.user.id,
    },
  });

  await prisma.historiqueEntry.create({
    data: {
      entity: "Demande",
      entityId: reglement.demandeId,
      action: "declaration_retour",
      detail: `Retour de caisse déclaré : ${montantARetourner.toLocaleString("fr-FR")} FCFA à retourner`,
      userId: session.user.id,
    },
  });

  revalidatePath(`/treso/demandes/${reglement.demandeId}`);
  revalidatePath("/treso/demandes");

  return { status: "success", message: "Retour de caisse déclaré." };
}

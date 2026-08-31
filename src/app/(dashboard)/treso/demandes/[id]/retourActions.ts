"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type SimpleActionResult = { status: "success" | "error"; message: string };

const ligneDepenseSchema = z
  .object({
    montant: z.coerce.number().positive("Le montant doit être supérieur à 0"),
    objet: z.string().trim().min(1, "L'objet est obligatoire"),
    date: z.coerce.date({ message: "Date invalide" }),
    nature: z.string().trim().optional(),
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

const lignesSchema = z.array(ligneDepenseSchema).min(1, "Au moins une ligne de dépense est obligatoire.");

export interface LigneDepenseInput {
  montant: number;
  objet: string;
  date: string;
  nature?: string;
  justification: "FACTURE" | "RECU" | "TICKET" | "SANS_PIECE";
  commentaire?: string;
}

/**
 * Déclare un retour de caisse pour un règlement Caisse confirmé, sous la
 * forme de PLUSIEURS lignes de dépenses détaillées (Phase D, "fonds
 * remis" — cahier des charges sections 8-9 : remplace le montant dépensé
 * agrégé unique du Ticket 5). Réservée à `treso.declarer_retour`, et
 * uniquement sur les propres demandes du collaborateur connecté — jamais
 * sur celles d'un tiers (revérifié ici, pas seulement via la
 * navigation/l'affichage de la page).
 *
 * V1 : un règlement ne peut recevoir qu'un seul retour déclaré à la fois
 * (évite les doublons) — revérifié ici même si le bouton de déclaration ne
 * devrait normalement plus être visible une fois un retour créé.
 *
 * **`montantARetourner` est CALCULÉ ICI, jamais reçu du client** (voir
 * `RetourCaisse.montantARetourner` dans `schema.prisma` et CLAUDE.md
 * "Refonte V1 en cours" / Phase D) : montant du règlement moins la somme
 * des lignes de dépenses soumises, jamais négatif.
 *
 * RÈGLE CRITIQUE : cette action NE crée AUCUNE écriture `JournalCaisse` et
 * NE touche PAS au solde de caisse — seule la RÉCEPTION du retour par
 * Finance (Ticket 6, pas celui-ci) aura cet effet. Déclarer un retour
 * n'enregistre qu'une intention/justification côté collaborateur.
 *
 * Défense en profondeur (Ticket 7, corrigée Phase C) : la demande ne doit
 * pas être `CLOTUREE` — une fois clôturée, plus aucun nouveau retour ne
 * peut être déclaré, même si le règlement d'origine reste `estConfirme`
 * (ce champ ne change jamais après clôture, ce n'était donc pas suffisant
 * pour bloquer l'accès).
 */
export async function creerRetourCaisseAction(
  reglementId: string,
  lignes: LigneDepenseInput[]
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.declarer_retour")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsedLignes = lignesSchema.safeParse(lignes);
  if (!parsedLignes.success) {
    return { status: "error", message: parsedLignes.error.issues[0].message };
  }

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
  if (reglement.demande.statut === "CLOTUREE") {
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

  const totalDeclare = parsedLignes.data.reduce((sum, l) => sum + l.montant, 0);
  const montantARetourner = Math.max(0, Number(reglement.montant) - totalDeclare);

  await prisma.$transaction(async (tx) => {
    const retour = await tx.retourCaisse.create({
      data: { reglementId, declarantId: session.user.id, montantARetourner },
    });

    await tx.depenseLigne.createMany({
      data: parsedLignes.data.map((l) => ({
        retourCaisseId: retour.id,
        montant: l.montant,
        objet: l.objet,
        date: l.date,
        nature: l.nature?.trim() || null,
        justification: l.justification,
        commentaire: l.commentaire?.trim() || null,
      })),
    });

    await tx.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: reglement.demandeId,
        action: "declaration_retour",
        detail: `Retour de caisse déclaré : ${parsedLignes.data.length} ligne(s) de dépense, ${totalDeclare.toLocaleString("fr-FR")} FCFA déclarés, ${montantARetourner.toLocaleString("fr-FR")} FCFA à retourner`,
        userId: session.user.id,
      },
    });
  });

  revalidatePath(`/treso/demandes/${reglement.demandeId}`);
  revalidatePath("/treso/demandes");
  // Ticket 8 : un nouveau retour déclaré augmente aussitôt l'indicateur
  // "Retours de caisse en attente" du dashboard Finance et sa liste.
  revalidatePath("/treso/finance", "layout");

  return {
    status: "success",
    message: `Retour de caisse déclaré : ${montantARetourner.toLocaleString("fr-FR")} FCFA à retourner.`,
  };
}

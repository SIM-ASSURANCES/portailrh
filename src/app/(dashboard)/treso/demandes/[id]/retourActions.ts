"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { prisma } from "@/lib/prisma";

type SimpleActionResult = { status: "success" | "error"; message: string };

const ligneDepenseSchema = z
  .object({
    id: z.string().optional(),
    montant: z.coerce.number().positive("Le montant doit être supérieur à 0"),
    objet: z.string().trim().min(1, "L'objet est obligatoire"),
    date: z.coerce.date({ message: "Date invalide" }),
    nature: z.string().trim().optional(),
    justification: z.enum(["FACTURE", "RECU", "TICKET", "SANS_PIECE"]),
    commentaire: z.string().optional(),
    pieceJointeUrl: z.string().optional(),
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
  /**
   * Présent uniquement en modification (`modifierRetourCaisseAction`), pour
   * une ligne déjà en base : distingue une ligne à METTRE À JOUR (id connu)
   * d'une ligne à CRÉER (id absent). Jamais utilisé par la création
   * initiale (`creerRetourCaisseAction`), où aucune ligne n'a encore d'id.
   */
  id?: string;
  montant: number;
  objet: string;
  date: string;
  nature?: string;
  justification: "FACTURE" | "RECU" | "TICKET" | "SANS_PIECE";
  commentaire?: string;
  /** Nom de fichier renvoyé par `POST /api/treso/pieces-jointes/upload`, le cas échéant (facultatif). */
  pieceJointeUrl?: string;
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

    // `create` individuel par ligne (pas `createMany`) : nécessaire pour
    // pouvoir imbriquer la pièce jointe optionnelle de chaque ligne dans
    // la même écriture (`createMany` ne supporte pas les relations
    // imbriquées). Volume toujours modeste (quelques lignes par retour),
    // même convention que le reste du module pour ce genre de boucle.
    for (const l of parsedLignes.data) {
      await tx.depenseLigne.create({
        data: {
          retourCaisseId: retour.id,
          montant: l.montant,
          objet: l.objet,
          date: l.date,
          nature: l.nature?.trim() || null,
          justification: l.justification,
          commentaire: l.commentaire?.trim() || null,
          ...(l.pieceJointeUrl
            ? { pieceJointe: { create: { url: l.pieceJointeUrl, demandeId: reglement.demandeId } } }
            : {}),
        },
      });
    }

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
  publishDataChanged();

  return {
    status: "success",
    message: `Retour de caisse déclaré : ${montantARetourner.toLocaleString("fr-FR")} FCFA à retourner.`,
  };
}

/**
 * Modifie un retour de caisse **déjà déclaré mais pas encore réceptionné**
 * (Tâche « modification d'un retour de caisse avant réception ») : seul le
 * déclarant original peut corriger ses lignes de dépenses avant que Finance
 * ne traite le retour — une fois `estReceptionne`, c'est verrouillé
 * exactement comme avant cette action (aucune fonction de "dévalidation" ni
 * de correction rétroactive après réception, même principe que le reste du
 * module).
 *
 * **Diff par id, jamais un `deleteMany` + `createMany` en bloc** : une
 * ligne du payload avec un `id` connu est mise à jour EN PLACE (préserve sa
 * `PieceJointe` éventuelle, Tâche pièce jointe) ; une ligne sans `id` est
 * créée ; une ligne existante en base mais absente du payload est
 * supprimée (et sa `PieceJointe`, le cas échéant, avec elle — voir
 * `onDelete: Cascade` sur `DepenseLigne.pieceJointe` dans `schema.prisma`).
 * Un simple "tout supprimer puis tout recréer" aurait perdu silencieusement
 * les pièces jointes déjà attachées aux lignes conservées à l'identique.
 *
 * `montantARetourner` recalculé exactement comme à la création — toujours
 * côté serveur, jamais reçu du client.
 */
export async function modifierRetourCaisseAction(
  retourId: string,
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

  const retour = await prisma.retourCaisse.findUnique({
    where: { id: retourId },
    include: { reglement: { include: { demande: true } }, depenses: true },
  });

  if (!retour) {
    return { status: "error", message: "Retour de caisse introuvable." };
  }
  if (retour.estReceptionne) {
    return { status: "error", message: "Ce retour de caisse a déjà été réceptionné : il n'est plus modifiable." };
  }
  if (retour.declarantId !== session.user.id) {
    return { status: "error", message: "Vous ne pouvez modifier que vos propres déclarations de retour." };
  }
  if (retour.reglement.demande.statut === "CLOTUREE") {
    return {
      status: "error",
      message: `Cette demande n'est plus modifiable (statut actuel : ${retour.reglement.demande.statut}).`,
    };
  }

  const ancienTotal = retour.depenses.reduce((sum, d) => sum + Number(d.montant), 0);
  const nouveauTotal = parsedLignes.data.reduce((sum, l) => sum + l.montant, 0);
  const montantARetourner = Math.max(0, Number(retour.reglement.montant) - nouveauTotal);

  const idsExistants = new Set(retour.depenses.map((d) => d.id));
  const idsConserves = new Set(parsedLignes.data.filter((l) => l.id).map((l) => l.id!));
  const idsASupprimer = [...idsExistants].filter((id) => !idsConserves.has(id));

  await prisma.$transaction(async (tx) => {
    if (idsASupprimer.length > 0) {
      await tx.depenseLigne.deleteMany({ where: { id: { in: idsASupprimer } } });
    }
    for (const l of parsedLignes.data) {
      const data = {
        montant: l.montant,
        objet: l.objet,
        date: l.date,
        nature: l.nature?.trim() || null,
        justification: l.justification,
        commentaire: l.commentaire?.trim() || null,
      };
      if (l.id && idsExistants.has(l.id)) {
        // Mise à jour EN PLACE : ne touche jamais `pieceJointe` — une
        // pièce déjà attachée à cette ligne (hors périmètre de cette
        // action) reste donc intacte, quelle que soit la valeur de
        // `pieceJointeUrl` envoyée par le client pour une ligne existante
        // (le formulaire ne propose d'ailleurs pas ce champ pour une ligne
        // déjà en base — voir `RetourCaisseForm.tsx`).
        await tx.depenseLigne.update({ where: { id: l.id }, data });
      } else {
        // Ligne réellement nouvelle (ajoutée pendant cette modification) :
        // peut porter sa propre pièce jointe, comme à la création.
        await tx.depenseLigne.create({
          data: {
            ...data,
            retourCaisseId: retourId,
            ...(l.pieceJointeUrl
              ? { pieceJointe: { create: { url: l.pieceJointeUrl, demandeId: retour.reglement.demandeId } } }
              : {}),
          },
        });
      }
    }
    await tx.retourCaisse.update({ where: { id: retourId }, data: { montantARetourner } });
    await tx.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: retour.reglement.demandeId,
        action: "modification_retour",
        detail: `Retour de caisse modifié : total déclaré ${ancienTotal.toLocaleString("fr-FR")} FCFA → ${nouveauTotal.toLocaleString("fr-FR")} FCFA (${parsedLignes.data.length} ligne(s), ${montantARetourner.toLocaleString("fr-FR")} FCFA à retourner)`,
        userId: session.user.id,
      },
    });
  });

  revalidatePath(`/treso/demandes/${retour.reglement.demandeId}`);
  revalidatePath("/treso/demandes");
  revalidatePath("/treso/finance", "layout");
  publishDataChanged();

  return {
    status: "success",
    message: `Retour de caisse modifié : ${montantARetourner.toLocaleString("fr-FR")} FCFA à retourner.`,
  };
}

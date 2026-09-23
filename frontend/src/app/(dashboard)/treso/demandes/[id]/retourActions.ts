"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { notifierParPermission } from "@/lib/notifications";
import { calculerMontantARetournerNet, getDateDernierReglementConfirme, prisma } from "backend";

type SimpleActionResult = { status: "success" | "error"; message: string };

const montantRetourneSchema = z.coerce.number().min(0, "Le montant retourné doit être un nombre positif ou nul.");

const dateRetourSchema = z
  .string()
  .trim()
  .min(1, "La date du retour est obligatoire.")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Date invalide");

/**
 * Construit la ligne de dépense SYNTHÉTIQUE représentant la part NON
 * retournée d'un retour Collaborateur — voir CLAUDE.md "Retirer la saisie
 * de justification par le Collaborateur" : `creerRetourCaisseAction`/
 * `modifierRetourCaisseAction` n'acceptent plus qu'une date et un montant
 * retourné, JAMAIS un objet/une justification/une pièce jointe saisis par
 * le Collaborateur — même côté serveur, pas seulement dans l'UI qui les
 * saisissait autrefois. Toute classification (justifié/non justifié,
 * motif, pièce jointe) reste exclusivement le fait de l'Assistant Finance
 * (`declarerRetourAssistantAction`/`marquerDepenseNonJustifieeAction`,
 * `treso/finance/retours/retourActions.ts`) : cette ligne synthétique est
 * TOUJOURS `SANS_PIECE`, avec un commentaire fixe expliquant son origine —
 * jamais une valeur transmise par le client.
 */
function construireLigneSynthetique(montantDepense: number, date: Date) {
  return montantDepense > 0
    ? [
        {
          montant: montantDepense,
          objet: "Dépenses non détaillées",
          date,
          nature: null as string | null,
          justification: "SANS_PIECE" as const,
          commentaire: "Déclaration simplifiée (date + montant) : dépenses non détaillées par le collaborateur.",
        },
      ]
    : [];
}

/**
 * Déclare un retour de caisse pour un règlement Caisse confirmé. Réservée
 * à `treso.declarer_retour`, et uniquement sur les propres demandes du
 * collaborateur connecté — jamais sur celles d'un tiers (revérifié ici,
 * pas seulement via la navigation/l'affichage de la page).
 *
 * **Signature volontairement réduite à `(reglementId, montantRetourne,
 * dateRetour)`** — voir CLAUDE.md "Retirer la saisie de justification par
 * le Collaborateur" : avant cette tâche, un formulaire "détaillé" restait
 * accessible au Collaborateur (plusieurs lignes de dépense avec
 * objet/justification/commentaire/pièce jointe saisis par lui), en plus du
 * formulaire simplifié (date + montant). Cette action acceptait alors un
 * tableau `LigneDepenseInput[]` arbitraire — un rejeu réseau direct aurait
 * donc pu faire porter une "justification" au Collaborateur même avec le
 * formulaire détaillé retiré de l'UI seule. Supprimer purement et
 * simplement le paramètre `lignes` ferme cette possibilité au niveau du
 * type, pas seulement par convention d'interface : le Collaborateur ne
 * peut plus JAMAIS transmettre à cette action ni objet, ni justification,
 * ni commentaire, ni pièce jointe — seule une ligne SYNTHÉTIQUE `SANS_PIECE`
 * générée ici (`construireLigneSynthetique`) peut exister.
 *
 * **`montantARetourner` est CALCULÉ ICI, jamais reçu du client** (voir
 * `RetourCaisse.montantARetourner` dans `schema.prisma`) : montant du
 * règlement moins la part non retournée déduite du montant retourné
 * annoncé, jamais négatif.
 *
 * RÈGLE CRITIQUE : cette action NE crée AUCUNE écriture `JournalCaisse` et
 * NE touche PAS au solde de caisse — seule la RÉCEPTION du retour par
 * Finance (`receptionnerRetourAction`) aura cet effet. Déclarer un retour
 * n'enregistre qu'une intention côté collaborateur.
 *
 * Défense en profondeur : la demande ne doit pas être `CLOTUREE` — une
 * fois clôturée, plus aucun nouveau retour ne peut être déclaré, même si
 * le règlement d'origine reste `estConfirme`.
 *
 * **Retours multiples** (voir CLAUDE.md "Retours multiples autorisés sur
 * une même demande") — jamais deux retours EN ATTENTE simultanément sur le
 * même règlement ; un nouveau redevient possible dès que le précédent est
 * réceptionné.
 */
export async function creerRetourCaisseAction(
  reglementId: string,
  montantRetourne: number,
  dateRetour: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.declarer_retour")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsedMontant = montantRetourneSchema.safeParse(montantRetourne);
  if (!parsedMontant.success) {
    return { status: "error", message: parsedMontant.error.issues[0].message };
  }
  const parsedDateRetour = dateRetourSchema.safeParse(dateRetour);
  if (!parsedDateRetour.success) {
    return { status: "error", message: parsedDateRetour.error.issues[0].message };
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
  if (parsedMontant.data > Number(reglement.montant)) {
    return {
      status: "error",
      message: `Le montant retourné ne peut pas dépasser le montant du règlement (${Number(reglement.montant).toLocaleString("fr-FR")} FCFA).`,
    };
  }
  // Tâche "Retours multiples autorisés sur une même demande" : jamais deux
  // retours EN ATTENTE simultanément sur le même règlement.
  if (reglement.retours.some((r) => !r.estReceptionne)) {
    return {
      status: "error",
      message: "Un retour est déjà en attente de réception pour ce règlement : attendez qu'il soit traité avant d'en déclarer un nouveau.",
    };
  }

  // Tâche "Libellés et validations sur le formulaire de retour" : la date de
  // retour ne peut pas être antérieure au règlement/décaissement le plus
  // récent confirmé sur la demande — comparée en granularité JOUR.
  const dateDernierReglement = await getDateDernierReglementConfirme(reglement.demandeId);
  if (dateDernierReglement) {
    const dateDernierReglementStr = dateDernierReglement.toISOString().slice(0, 10);
    if (parsedDateRetour.data < dateDernierReglementStr) {
      return {
        status: "error",
        message: `La date du retour ne peut pas être antérieure au dernier règlement confirmé sur cette demande (${dateDernierReglement.toLocaleDateString("fr-FR")}).`,
      };
    }
  }

  const montantDepense = Math.max(0, Number(reglement.montant) - parsedMontant.data);
  const lignes = construireLigneSynthetique(montantDepense, new Date(parsedDateRetour.data));
  const montantARetourner = await calculerMontantARetournerNet({
    reglementId,
    totalDepensesNouvelles: montantDepense,
  });

  await prisma.$transaction(async (tx) => {
    const retour = await tx.retourCaisse.create({
      data: {
        reglementId,
        declarantId: session.user.id,
        montantARetourner,
        dateRetour: new Date(parsedDateRetour.data),
      },
    });

    for (const l of lignes) {
      await tx.depenseLigne.create({ data: { retourCaisseId: retour.id, ...l } });
    }

    await tx.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: reglement.demandeId,
        action: "declaration_retour",
        detail:
          montantDepense > 0
            ? `Retour de caisse déclaré : ${parsedMontant.data.toLocaleString("fr-FR")} FCFA retournés, ${montantDepense.toLocaleString("fr-FR")} FCFA de solde non détaillé, ${montantARetourner.toLocaleString("fr-FR")} FCFA restant à retourner`
            : `Retour de caisse déclaré : aucune dépense (retour intégral), ${montantARetourner.toLocaleString("fr-FR")} FCFA à retourner`,
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

  await notifierParPermission("treso.receptionner_retour", {
    titre: "Retour de caisse à réceptionner",
    message: `Un retour de caisse de ${montantARetourner.toLocaleString("fr-FR")} FCFA a été déclaré sur la demande ${reglement.demande.reference}.`,
    lien: "/treso/finance/retours",
  });

  return {
    status: "success",
    message: `Retour de caisse déclaré : ${montantARetourner.toLocaleString("fr-FR")} FCFA à retourner.`,
  };
}

/**
 * Modifie un retour de caisse **déjà déclaré mais pas encore réceptionné**
 * — seul le déclarant original peut corriger sa date/son montant avant que
 * Finance ne traite le retour. Une fois `estReceptionne`, c'est verrouillé
 * (aucune fonction de "dévalidation" ni de correction rétroactive après
 * réception, même principe que le reste du module).
 *
 * **Signature réduite à `(retourId, montantRetourne, dateRetour)`**, même
 * principe et même raison que `creerRetourCaisseAction` ci-dessus (voir
 * CLAUDE.md "Retirer la saisie de justification par le Collaborateur") :
 * plus de tableau de lignes arbitraire, le Collaborateur ne peut plus
 * transmettre ni objet, ni justification, ni pièce jointe à cette action.
 *
 * **Remplace TOUJOURS l'intégralité des lignes existantes** par au plus
 * UNE ligne synthétique fraîche (`construireLigneSynthetique`) — jamais de
 * diff par id : le Collaborateur ne produit plus qu'une seule ligne
 * possible, un diff n'a donc plus de sens. Une éventuelle ligne détaillée
 * (avec sa propre pièce jointe) créée AVANT cette tâche via l'ancien
 * formulaire détaillé disparaît à la première modification suivante —
 * comportement attendu, ce chemin de saisie n'existe plus.
 *
 * `montantARetourner` recalculé exactement comme à la création — toujours
 * côté serveur, jamais reçu du client.
 */
export async function modifierRetourCaisseAction(
  retourId: string,
  montantRetourne: number,
  dateRetour: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.declarer_retour")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsedMontant = montantRetourneSchema.safeParse(montantRetourne);
  if (!parsedMontant.success) {
    return { status: "error", message: parsedMontant.error.issues[0].message };
  }
  const parsedDateRetour = dateRetourSchema.safeParse(dateRetour);
  if (!parsedDateRetour.success) {
    return { status: "error", message: parsedDateRetour.error.issues[0].message };
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
  if (parsedMontant.data > Number(retour.reglement.montant)) {
    return {
      status: "error",
      message: `Le montant retourné ne peut pas dépasser le montant du règlement (${Number(retour.reglement.montant).toLocaleString("fr-FR")} FCFA).`,
    };
  }

  const dateDernierReglement = await getDateDernierReglementConfirme(retour.reglement.demandeId);
  if (dateDernierReglement) {
    const dateDernierReglementStr = dateDernierReglement.toISOString().slice(0, 10);
    if (parsedDateRetour.data < dateDernierReglementStr) {
      return {
        status: "error",
        message: `La date du retour ne peut pas être antérieure au dernier règlement confirmé sur cette demande (${dateDernierReglement.toLocaleDateString("fr-FR")}).`,
      };
    }
  }

  const ancienTotal = retour.depenses.reduce((sum, d) => sum + Number(d.montant), 0);
  const montantDepense = Math.max(0, Number(retour.reglement.montant) - parsedMontant.data);
  const nouvellesLignes = construireLigneSynthetique(montantDepense, new Date(parsedDateRetour.data));
  // Tâche "Retours multiples autorisés sur une même demande" : exclut CE
  // retour de son propre calcul, nette correctement contre d'éventuels
  // autres retours déjà existants sur ce même règlement.
  const montantARetourner = await calculerMontantARetournerNet({
    reglementId: retour.reglementId,
    totalDepensesNouvelles: montantDepense,
    excludeRetourId: retourId,
  });

  await prisma.$transaction(async (tx) => {
    await tx.depenseLigne.deleteMany({ where: { retourCaisseId: retourId } });
    for (const l of nouvellesLignes) {
      await tx.depenseLigne.create({ data: { retourCaisseId: retourId, ...l } });
    }
    await tx.retourCaisse.update({
      where: { id: retourId },
      data: { montantARetourner, dateRetour: new Date(parsedDateRetour.data) },
    });
    await tx.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: retour.reglement.demandeId,
        action: "modification_retour",
        detail: `Retour de caisse modifié : montant retourné ${Math.max(0, Number(retour.reglement.montant) - ancienTotal).toLocaleString("fr-FR")} FCFA → ${parsedMontant.data.toLocaleString("fr-FR")} FCFA (${montantARetourner.toLocaleString("fr-FR")} FCFA restant à retourner)`,
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

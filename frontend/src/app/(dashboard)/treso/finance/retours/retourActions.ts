"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { notifierParPermission, notify } from "@/lib/notifications";
import { snapshotLigne, type CorrectionDetail, type LigneSnapshot } from "@/lib/correctionRetour";
import { calculerMontantARetournerNet, getRecuNetSignalement, getSoldeCaisse, prisma } from "backend";

type SimpleActionResult = { status: "success" | "error"; message: string };

const motifReouvertureSchema = z
  .string()
  .trim()
  .min(10, "Le motif de réouverture exceptionnelle est obligatoire (10 caractères minimum)");

/**
 * Permet à l'Assistant Finance de déclarer LUI-MÊME l'existence d'un retour
 * de caisse en l'absence de dépôt du collaborateur, qu'une demande soit
 * active ou déjà `CLOTUREE` (réouverture exceptionnelle) — voir CLAUDE.md
 * "L'Assistant Finance détaille réellement le retour".
 *
 * **Signature réduite à `(reglementId, motifReouverture?)`, sans aucune
 * ligne** — depuis la Tâche "L'Assistant Finance détaille réellement le
 * retour" (voir CLAUDE.md) : cette action ne fait plus que créer le retour
 * avec UNE ligne générique `SANS_PIECE` ("Dépenses non détaillées",
 * couvrant l'intégralité du montant restant à expliquer), EXACTEMENT comme
 * le ferait un collaborateur via le formulaire simplifié
 * (`construireLigneSynthetique`, `treso/demandes/[id]/retourActions.ts` —
 * dupliqué ici plutôt qu'importé, même principe de séparation des domaines
 * de permission déjà documenté ailleurs dans ce fichier). Le VRAI détail
 * (libellés réels, pièces jointes, justification) se fait ensuite via
 * **`detaillerDepensesRetourAction`** ci-dessous, sur l'écran de détail du
 * retour — le MÊME mécanisme, peu importe l'origine du retour (déclaré par
 * le collaborateur, ou par l'Assistant en son absence) : plus aucune
 * saisie de lignes détaillées à la création, une seule façon de détailler.
 *
 * **Deux cas distincts, un seul mécanisme** :
 * - Demande NON clôturée : cas normal, `motifReouverture` ignoré.
 * - Demande `CLOTUREE` : réouverture EXCEPTIONNELLE, `motifReouverture`
 *   OBLIGATOIRE (10 caractères minimum) — stocké sur
 *   `RetourCaisse.motifReouvertureExceptionnelle`, seul champ qui autorise
 *   ensuite `receptionnerRetourAction`/`detaillerDepensesRetourAction` à
 *   s'exécuter malgré le statut `CLOTUREE`.
 *
 * **Ne réceptionne PAS automatiquement** : crée le retour avec
 * `estReceptionne: false` — la réception reste une action DISTINCTE
 * (`receptionnerRetourAction`).
 *
 * Même règle "un seul retour EN ATTENTE à la fois par règlement" que
 * `creerRetourCaisseAction` (voir CLAUDE.md "Retours multiples autorisés
 * sur une même demande").
 */
export async function declarerRetourAssistantAction(
  reglementId: string,
  motifReouverture?: string,
  /** Règlement BANQUE uniquement (voir CLAUDE.md "Retour sur règlement Banque") : bordereau de versement OBLIGATOIRE. */
  bordereauUrl?: string,
  /** Règlement BANQUE uniquement : montant réellement reversé (> 0) ; le reste est la dépense à détailler. */
  montantRetourneBanque?: number
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.receptionner_retour")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const reglement = await prisma.reglement.findUnique({
    where: { id: reglementId },
    include: { demande: true, retours: true },
  });
  if (!reglement) {
    return { status: "error", message: "Règlement introuvable." };
  }
  if (!reglement.estConfirme || reglement.estAnnule) {
    return { status: "error", message: "Ce règlement n'est pas éligible à un retour de caisse." };
  }
  // Branche selon le mode : Caisse = flux existant, Banque = bordereau
  // obligatoire + écriture JournalBanque, AUCUN contrôle de solde.
  const estBanque = reglement.mode === "BANQUE";
  if (estBanque) {
    if (!bordereauUrl || !bordereauUrl.trim()) {
      return { status: "error", message: "Un bordereau de versement est obligatoire pour un retour sur un règlement Banque." };
    }
    if (!montantRetourneBanque || !(montantRetourneBanque > 0)) {
      return { status: "error", message: "Le montant retourné doit être supérieur à 0 pour un retour Banque." };
    }
  }
  if (reglement.retours.some((r) => !r.estReceptionne)) {
    return {
      status: "error",
      message: "Un retour est déjà en attente de réception pour ce règlement : attendez qu'il soit traité avant d'en déclarer un nouveau.",
    };
  }

  let motifValide: string | null = null;
  if (reglement.demande.statut === "CLOTUREE") {
    const parsedMotif = motifReouvertureSchema.safeParse(motifReouverture);
    if (!parsedMotif.success) {
      return { status: "error", message: parsedMotif.error.issues[0].message };
    }
    motifValide = parsedMotif.data;
  }

  // Restant disponible sur ce règlement AVANT ce nouveau retour (nette déjà
  // contre d'éventuels autres retours existants — voir CLAUDE.md "Retours
  // multiples autorisés sur une même demande") : la ligne générique couvre
  // l'intégralité de ce restant, rien retourné, tout dépensé, à détailler
  // ensuite.
  const restantTotal = await calculerMontantARetournerNet({ reglementId, totalDepensesNouvelles: 0 });
  if (estBanque && montantRetourneBanque! > restantTotal) {
    return {
      status: "error",
      message: `Le montant retourné ne peut pas dépasser le montant restant sur ce règlement (${restantTotal.toLocaleString("fr-FR")} FCFA).`,
    };
  }
  // Caisse : tout le restant est "dépensé, à détailler" (montantARetourner = 0).
  // Banque : la part reversée est déduite, seule la différence est à détailler.
  const restant = estBanque ? Math.round((restantTotal - montantRetourneBanque!) * 100) / 100 : restantTotal;
  const montantARetourner = await calculerMontantARetournerNet({ reglementId, totalDepensesNouvelles: restant });

  await prisma.$transaction(async (tx) => {
    const retour = await tx.retourCaisse.create({
      data: {
        reglementId,
        declarantId: session.user.id,
        montantARetourner,
        creeParAssistant: true,
        motifReouvertureExceptionnelle: motifValide,
      },
    });

    if (estBanque) {
      const piece = await tx.pieceJointe.create({ data: { url: bordereauUrl!.trim(), demandeId: reglement.demandeId } });
      await tx.journalBanque.create({
        data: {
          type: "RETOUR",
          montant: montantARetourner,
          reglementId,
          retourCaisseId: retour.id,
          pieceJointeId: piece.id,
          creeParId: session.user.id,
        },
      });
    }

    if (restant > 0) {
      await tx.depenseLigne.create({
        data: {
          retourCaisseId: retour.id,
          montant: restant,
          objet: "Dépenses non détaillées",
          date: new Date(),
          justification: "SANS_PIECE",
          commentaire: "Retour intégral déclaré par l'Assistant Finance en l'absence de dépôt du collaborateur — détail à renseigner.",
        },
      });
    }

    await tx.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: reglement.demandeId,
        // Action DISTINCTE du cas normal ("clairement visible et distincte
        // dans l'historique, pas confondue avec un retour normal") —
        // jamais la même valeur que `declaration_retour` (collaborateur)
        // ni que `declaration_retour_assistant` (cas non clôturé) l'une
        // pour l'autre.
        action: motifValide ? "reouverture_exceptionnelle_retour" : "declaration_retour_assistant",
        detail: motifValide
          ? `Réouverture exceptionnelle post-clôture : retour de caisse complémentaire déclaré par l'Assistant Finance (${restant.toLocaleString("fr-FR")} FCFA à détailler) — motif : ${motifValide}`
          : `Retour de caisse déclaré par l'Assistant Finance (aucune déclaration du collaborateur) : ${restant.toLocaleString("fr-FR")} FCFA à détailler`,
        userId: session.user.id,
      },
    });
  });

  revalidatePath(`/treso/demandes/${reglement.demandeId}`);
  revalidatePath(`/treso/finance/demandes/${reglement.demandeId}`);
  revalidatePath("/treso/finance/retours");
  revalidatePath("/treso/finance", "layout");
  publishDataChanged();

  await notifierParPermission("treso.receptionner_retour", {
    titre: "Retour de caisse à réceptionner",
    message: `Un retour de caisse de ${restant.toLocaleString("fr-FR")} FCFA (déclaré par l'Assistant Finance) reste à détailler et réceptionner sur la demande ${reglement.demande.reference}.`,
    lien: "/treso/finance/retours",
  });

  return {
    status: "success",
    message: motifValide
      ? "Retour de caisse complémentaire déclaré (réouverture exceptionnelle) — détaillez-le sur l'écran de détail."
      : "Retour de caisse déclaré — détaillez-le sur l'écran de détail.",
  };
}

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
  // Tâche "Réouverture exceptionnelle post-clôture pour retour de caisse
  // oublié" (voir CLAUDE.md) : une demande CLOTUREE reste bloquée pour
  // TOUTE réception, SAUF pour un retour créé via l'exception explicite de
  // `declarerRetourAssistantAction` (`motifReouvertureExceptionnelle` non
  // nul) — aucune autre action n'est réactivée par cette exception, elle
  // ne concerne QUE ce retour précis.
  if (retour.reglement.demande.statut === "CLOTUREE" && !retour.motifReouvertureExceptionnelle) {
    return {
      status: "error",
      message: `Cette demande n'est plus modifiable (statut actuel : ${retour.reglement.demande.statut}).`,
    };
  }

  const demandeId = retour.reglement.demandeId;
  const montant = retour.montantARetourner;

  // Retour sur règlement BANQUE : la réception ne touche JAMAIS `JournalCaisse`
  // (règle impérative n°3 — la Banque n'impacte pas la caisse) ; le mouvement
  // `JournalBanque` RETOUR a déjà été écrit à la déclaration, avec son bordereau.
  const estBanque = retour.reglement.mode === "BANQUE";
  await prisma.$transaction([
    prisma.retourCaisse.update({
      where: { id: retourId },
      data: {
        estReceptionne: true,
        receptionneParId: session.user.id,
        receptionneAt: new Date(),
      },
    }),
    ...(estBanque
      ? []
      : [
          prisma.journalCaisse.create({
            data: {
              type: "ENTREE",
              montant,
              source: "retour_caisse_receptionne",
              refId: retourId,
              // Traçabilité (section 13) : la demande d'origine (via
              // Reglement -> Demande) et l'utilisateur qui réceptionne,
              // identique à `receptionneParId` ci-dessus.
              demandeId,
              userId: session.user.id,
            },
          }),
        ]),
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

const ligneDetailSchema = z
  .object({
    libelle: z.string().trim().min(1, "Le libellé est obligatoire."),
    montant: z.coerce.number().positive("Le montant doit être supérieur à 0."),
    pieceJointeFournie: z.boolean(),
    pieceJointeUrl: z.string().optional(),
    justifiee: z.boolean(),
    motif: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.pieceJointeFournie && !data.pieceJointeUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["pieceJointeUrl"],
        message: "Téléversez le fichier, ou indiquez qu'aucune pièce jointe n'est fournie.",
      });
    }
    // Tâche "Refonte de la zone 'Régularisation'" (voir CLAUDE.md) : une
    // dépense JUSTIFIÉE exige désormais explicitement une pièce jointe
    // (jamais déduit — état déjà EXPLICITE par ailleurs, voir
    // `LigneDetailInput.pieceJointeFournie`) ; auparavant, `justifiee: true`
    // sans aucune pièce passait la validation, contrairement à la lecture du
    // libellé "Justifiée." affiché ensuite côté Collaborateur.
    if (data.justifiee && (!data.pieceJointeFournie || !data.pieceJointeUrl)) {
      ctx.addIssue({
        code: "custom",
        path: ["pieceJointeFournie"],
        message: "Une pièce jointe est obligatoire pour une dépense justifiée.",
      });
    }
    if (!data.justifiee && (!data.motif || data.motif.trim().length < 3)) {
      ctx.addIssue({
        code: "custom",
        path: ["motif"],
        message: "Le motif est obligatoire (3 caractères minimum) pour une dépense non justifiée.",
      });
    }
  });
const lignesDetailSchema = z.array(ligneDetailSchema);

export interface LigneDetailInput {
  /** Texte libre décrivant l'usage réel de la dépense (ex: "Transport pour livraison X"). */
  libelle: string;
  montant: number;
  /** État EXPLICITE, jamais déduit du silence — voir CLAUDE.md "L'Assistant
   * Finance détaille réellement le retour" : `false` affiche "Aucune pièce
   * jointe fournie." côté Collaborateur, jamais une simple absence muette. */
  pieceJointeFournie: boolean;
  /** Requis si `pieceJointeFournie`. Nom de fichier renvoyé par `POST /api/treso/pieces-jointes/upload`. */
  pieceJointeUrl?: string;
  /** `true` = justifiée (enregistrée avec `justification: "FACTURE"`, la
   * pièce jointe éventuelle faisant foi) ; `false` = non justifiée
   * (`justification: "SANS_PIECE"` + `motif` obligatoire, mêmes champs
   * `motifNonJustifie*` que `marquerDepenseNonJustifieeAction`). */
  justifiee: boolean;
  motif?: string;
}

/**
 * **Mécanisme UNIFIÉ de détail réel d'un retour de caisse** — voir CLAUDE.md
 * "L'Assistant Finance détaille réellement le retour" : remplace la ou les
 * lignes ACTUELLES d'un retour (qu'elles soient le générique "Dépenses non
 * détaillées" produit par le formulaire simplifié du Collaborateur OU par
 * `declarerRetourAssistantAction`, ou même un détail déjà saisi
 * précédemment) par un détail réel — un ou plusieurs libellés/montants,
 * chacun avec une pièce jointe (ou la mention explicite de son absence) et
 * un statut justifié/non justifié (motif obligatoire sinon, mêmes champs
 * que `marquerDepenseNonJustifieeAction`). Réservée à
 * `treso.receptionner_retour` — même permission que toutes les actions de
 * ce type, Responsable Finance et DG exclus.
 *
 * **Une seule façon de détailler, peu importe l'origine du retour** :
 * jamais deux mécanismes séparés pour "retour réellement soumis" et "aucun
 * retour soumis" — les deux convergent vers un retour portant une ligne
 * générique, détaillée ici de façon identique.
 *
 * **Validation stricte du total** — la somme des nouvelles lignes doit
 * égaler EXACTEMENT le total dépensé déjà établi pour ce retour (la somme
 * de ses lignes ACTUELLES, jamais recalculée à partir du règlement : ce
 * total n'est jamais modifié par cette action, seule sa RÉPARTITION change)
 * — comparaison en centimes entiers, écart exact renvoyé dans le message de
 * refus pour aider l'Assistant à corriger sa saisie.
 *
 * **Verrouillage** : comme toute autre correction du détail, refusée une
 * fois le retour réceptionné — SAUF exception ciblée et tracée :
 * - Demande `CLOTUREE` sans `retour.motifReouvertureExceptionnelle` : refusée
 *   (même garde que `receptionnerRetourAction`).
 * - Retour déjà réceptionné : refusée, SAUF s'il existe un
 *   `SignalementRetour` actif (`estResolu: false`) pour ce retour (voir
 *   CLAUDE.md "Signalement d'erreur par le Collaborateur") — dans ce cas,
 *   la correction est appliquée ET le signalement est marqué résolu dans
 *   la MÊME transaction (le retour se reverrouille alors normalement :
 *   sans nouveau signalement, une tentative suivante est de nouveau
 *   refusée).
 */
export async function detaillerDepensesRetourAction(
  retourId: string,
  lignes: LigneDetailInput[]
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.receptionner_retour")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsedLignes = lignesDetailSchema.safeParse(lignes);
  if (!parsedLignes.success) {
    return { status: "error", message: parsedLignes.error.issues[0].message };
  }

  const retour = await prisma.retourCaisse.findUnique({
    where: { id: retourId },
    include: {
      reglement: { include: { demande: true } },
      depenses: true,
      signalements: { where: { estResolu: false } },
    },
  });
  if (!retour) {
    return { status: "error", message: "Retour de caisse introuvable." };
  }
  if (retour.reglement.demande.statut === "CLOTUREE" && !retour.motifReouvertureExceptionnelle) {
    return {
      status: "error",
      message: `Cette demande n'est plus modifiable (statut actuel : ${retour.reglement.demande.statut}).`,
    };
  }

  const signalementActif = retour.signalements[0] ?? null;
  if (retour.estReceptionne && !signalementActif) {
    return {
      status: "error",
      message:
        "Ce retour de caisse a déjà été réceptionné : la modification du détail nécessite un signalement actif du collaborateur.",
    };
  }

  const montantCible = retour.depenses.reduce((sum, d) => sum + Number(d.montant), 0);
  const nouveauTotal = parsedLignes.data.reduce((sum, l) => sum + l.montant, 0);
  // Décomposition (voir CLAUDE.md "Décomposition du montant déclaré") : la
  // somme des entrées ne doit JAMAIS dépasser le total dépensé déclaré ; si
  // elle est inférieure, le reste demeure une ligne générique "Dépenses non
  // détaillées" (le total dépensé de ce retour n'est donc jamais modifié).
  const resteNonDetaille = Math.round((montantCible - nouveauTotal) * 100) / 100;
  if (resteNonDetaille < 0) {
    return {
      status: "error",
      message: `La somme des entrées (${nouveauTotal.toLocaleString("fr-FR")} FCFA) dépasse le montant total déclaré pour cette dépense (${montantCible.toLocaleString("fr-FR")} FCFA) — ${Math.abs(resteNonDetaille).toLocaleString("fr-FR")} FCFA en trop.`,
    };
  }

  const demandeId = retour.reglement.demandeId;
  const dateLignes = retour.dateRetour ?? retour.createdAt;

  await prisma.$transaction(async (tx) => {
    // Trace complète (voir CLAUDE.md "Conserver la trace complète des
    // corrections") : instantané AVANT (lignes + pièces jointes), pièces
    // DÉTACHÉES (jamais supprimées en cascade), puis lignes remplacées.
    const anciennes = await tx.depenseLigne.findMany({
      where: { retourCaisseId: retourId },
      include: { pieceJointe: { select: { id: true, url: true } } },
      orderBy: { createdAt: "asc" },
    });
    const avant: LigneSnapshot[] = anciennes.map(snapshotLigne);
    await tx.pieceJointe.updateMany({
      where: { depenseLigneId: { in: anciennes.map((a) => a.id) } },
      data: { depenseLigneId: null, demandeId },
    });
    await tx.depenseLigne.deleteMany({ where: { retourCaisseId: retourId } });
    const apres: LigneSnapshot[] = [];

    for (const l of parsedLignes.data) {
      const creee = await tx.depenseLigne.create({
        include: { pieceJointe: { select: { id: true, url: true } } },
        data: {
          retourCaisseId: retourId,
          montant: l.montant,
          objet: l.libelle,
          date: dateLignes,
          justification: l.justifiee ? "FACTURE" : "SANS_PIECE",
          ...(l.justifiee
            ? {}
            : {
                motifNonJustifie: l.motif!.trim(),
                motifNonJustifieParId: session.user.id,
                motifNonJustifieAt: new Date(),
              }),
          ...(l.pieceJointeFournie && l.pieceJointeUrl
            ? { pieceJointe: { create: { url: l.pieceJointeUrl, demandeId } } }
            : {}),
        },
      });
      apres.push(snapshotLigne(creee));
    }

    if (resteNonDetaille > 0) {
      const reste = await tx.depenseLigne.create({
        include: { pieceJointe: { select: { id: true, url: true } } },
        data: {
          retourCaisseId: retourId,
          montant: resteNonDetaille,
          objet: "Dépenses non détaillées",
          date: dateLignes,
          justification: "SANS_PIECE",
          commentaire: "Reste du montant déclaré non encore détaillé par l'équipe Finance.",
        },
      });
      apres.push(snapshotLigne(reste));
    }
    const detailCorrection: CorrectionDetail = {
      v: 1,
      resume: signalementActif
        ? `Détail du retour corrigé par l'Assistant Finance suite au signalement du collaborateur (${apres.length} ligne(s), ${montantCible.toLocaleString("fr-FR")} FCFA) — signalement résolu.`
        : `Détail réel du retour renseigné par l'Assistant Finance (${apres.length} ligne(s), ${montantCible.toLocaleString("fr-FR")} FCFA).`,
      signalement: signalementActif?.commentaire ?? null,
      avant,
      apres,
    };

    if (signalementActif) {
      await tx.signalementRetour.update({
        where: { id: signalementActif.id },
        data: { estResolu: true, resoluParId: session.user.id, resoluAt: new Date() },
      });
    }

    await tx.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: demandeId,
        // Action DISTINCTE quand la correction répond à un signalement
        // actif (voir CLAUDE.md "Signalement d'erreur par le
        // Collaborateur" : "traçabilité complète et distincte de la
        // correction elle-même") — jamais confondue avec un premier
        // détaillage normal.
        action: signalementActif ? "correction_signalement_retour" : "detaillage_retour",
        detail: JSON.stringify(detailCorrection),
        userId: session.user.id,
      },
    });
  });

  revalidatePath("/treso/finance/retours");
  revalidatePath(`/treso/finance/retours/${retourId}`);
  revalidatePath(`/treso/demandes/${demandeId}`);
  revalidatePath(`/treso/finance/demandes/${demandeId}`);
  revalidatePath("/treso/finance", "layout");
  publishDataChanged();

  return {
    status: "success",
    message: signalementActif
      ? "Détail corrigé — signalement résolu, retour reverrouillé."
      : "Détail des dépenses enregistré.",
  };
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
 * la ligne apparaisse dans le suivi "Dépense sans pièce formelle" (libellé
 * renommé, voir CLAUDE.md "Refonte de la zone 'Régularisation'")
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

const motifAjustementTotalSchema = z
  .string()
  .trim()
  .min(10, "Le motif de l'ajustement est obligatoire (10 caractères minimum)");

/**
 * Ajuste le TOTAL DÉCLARÉ d'un retour de caisse (Tâche "Le Responsable
 * Finance peut ajuster le total déclaré sous signalement actif", voir
 * CLAUDE.md) — le plafond de saisie de `detaillerDepensesRetourAction` est
 * la somme des lignes actuelles : l'ajuster ici relève ou abaisse ce
 * plafond.
 *
 * **Réservée au Responsable Finance UNIQUEMENT** (`treso.valider_demande` ET
 * PAS `treso.approuver_validation_complete`) — jamais l'Assistant Finance
 * (qui détaille dans la limite du total) ni le DG. **Uniquement sous
 * signalement actif** sur ce retour, motif ≥ 10 caractères, tracée dans
 * `HistoriqueEntry` (ancien total, nouveau total, motif, auteur).
 *
 * Mécanique : une hausse ajoute une ligne générique "Dépenses non
 * détaillées" (`SANS_PIECE`) de la différence ; une baisse ne peut retirer
 * que du montant encore "non détaillé" (jamais une ligne déjà détaillée par
 * l'Assistant). `montantARetourner` est recalculé tant que le retour n'est
 * PAS réceptionné ; une fois réceptionné, il reste inchangé (l'espèce
 * réellement rendue et écrite en caisse ne se réécrit pas) — un total relevé
 * peut alors faire apparaître un Solde à régulariser négatif, signal
 * d'anomalie déjà documenté.
 */
export async function ajusterTotalDeclareRetourAction(
  retourId: string,
  nouveauTotal: number,
  motif: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (
    !session ||
    !hasPermission(session, "treso.valider_demande") ||
    hasPermission(session, "treso.approuver_validation_complete")
  ) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsedMotif = motifAjustementTotalSchema.safeParse(motif);
  if (!parsedMotif.success) {
    return { status: "error", message: parsedMotif.error.issues[0].message };
  }
  if (!Number.isFinite(nouveauTotal) || nouveauTotal <= 0) {
    return { status: "error", message: "Le nouveau total doit être supérieur à 0." };
  }

  const retour = await prisma.retourCaisse.findUnique({
    where: { id: retourId },
    include: {
      reglement: { include: { demande: true } },
      depenses: true,
      signalements: { where: { estResolu: false } },
    },
  });
  if (!retour) {
    return { status: "error", message: "Retour de caisse introuvable." };
  }
  if (retour.signalements.length === 0) {
    return {
      status: "error",
      message: "Le total déclaré ne peut être ajusté que lorsqu'un signalement du collaborateur est actif sur ce retour.",
    };
  }
  if (retour.reglement.demande.statut === "CLOTUREE" && !retour.motifReouvertureExceptionnelle) {
    return { status: "error", message: "Cette demande est clôturée : le total n'est plus modifiable." };
  }
  if (nouveauTotal > Number(retour.reglement.montant)) {
    return {
      status: "error",
      message: `Le total déclaré ne peut pas dépasser le montant du règlement (${Number(retour.reglement.montant).toLocaleString("fr-FR")} FCFA).`,
    };
  }

  const ancienTotal = retour.depenses.reduce((sum, d) => sum + Number(d.montant), 0);
  const deltaCentimes = Math.round(nouveauTotal * 100) - Math.round(ancienTotal * 100);
  if (deltaCentimes === 0) {
    return { status: "error", message: "Le nouveau total est identique au total actuel." };
  }
  const delta = deltaCentimes / 100;

  const estGenerique = (d: { objet: string; motifNonJustifie: string | null }) =>
    d.objet === "Dépenses non détaillées" && !d.motifNonJustifie;
  const generiques = retour.depenses.filter(estGenerique);
  const totalGenerique = generiques.reduce((sum, d) => sum + Number(d.montant), 0);
  if (delta < 0 && Math.round(-delta * 100) > Math.round(totalGenerique * 100)) {
    return {
      status: "error",
      message: `Seuls ${totalGenerique.toLocaleString("fr-FR")} FCFA "non détaillés" peuvent être retirés : le détail déjà saisi par l'Assistant Finance ne se réduit pas ici.`,
    };
  }

  const demandeId = retour.reglement.demandeId;
  const dateLignes = retour.dateRetour ?? retour.createdAt;

  await prisma.$transaction(async (tx) => {
    if (delta > 0) {
      // Fusion avec la ligne "non détaillé" existante plutôt qu'une seconde ligne.
      await ajouterAuNonDetaille(tx, retourId, delta, dateLignes, `Ajustement du total déclaré par le Responsable Finance (${parsedMotif.data}).`);
    } else {
      let aRetirer = -delta;
      for (const g of generiques) {
        if (aRetirer <= 0) break;
        const m = Number(g.montant);
        if (m <= aRetirer) {
          await tx.depenseLigne.delete({ where: { id: g.id } });
          aRetirer = Math.round((aRetirer - m) * 100) / 100;
        } else {
          await tx.depenseLigne.update({ where: { id: g.id }, data: { montant: Math.round((m - aRetirer) * 100) / 100 } });
          aRetirer = 0;
        }
      }
    }

    if (!retour.estReceptionne) {
      const montantARetourner = await calculerMontantARetournerNet({
        reglementId: retour.reglementId,
        totalDepensesNouvelles: nouveauTotal,
        excludeRetourId: retourId,
      });
      await tx.retourCaisse.update({ where: { id: retourId }, data: { montantARetourner } });
    }

    await tx.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: demandeId,
        action: "ajustement_total_retour",
        detail: `Total déclaré du retour de caisse ajusté par ${session.user.fullName} : ${ancienTotal.toLocaleString("fr-FR")} → ${nouveauTotal.toLocaleString("fr-FR")} FCFA. Motif : ${parsedMotif.data}`,
        userId: session.user.id,
      },
    });
  });

  revalidatePath("/treso/finance/retours");
  revalidatePath(`/treso/finance/retours/${retourId}`);
  revalidatePath(`/treso/demandes/${demandeId}`);
  revalidatePath(`/treso/finance/demandes/${demandeId}`);
  revalidatePath("/treso/finance", "layout");
  publishDataChanged();

  await notifierParPermission("treso.receptionner_retour", {
    titre: "Total déclaré ajusté sur un retour de caisse",
    message: `Le Responsable Finance a ajusté le total déclaré (${ancienTotal.toLocaleString("fr-FR")} → ${nouveauTotal.toLocaleString("fr-FR")} FCFA) du retour de la demande ${retour.reglement.demande.reference} : vous pouvez maintenant corriger le détail.`,
    lien: `/treso/finance/retours/${retourId}`,
  });

  return { status: "success", message: "Total déclaré ajusté." };
}


type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Ajoute `montant` à la ligne générique "Dépenses non détaillées" du retour (la crée si absente). */
async function ajouterAuNonDetaille(tx: TxClient, retourId: string, montant: number, date: Date, commentaire: string) {
  const existante = await tx.depenseLigne.findFirst({
    where: { retourCaisseId: retourId, objet: "Dépenses non détaillées", motifNonJustifie: null },
    orderBy: { createdAt: "asc" },
  });
  if (existante) {
    await tx.depenseLigne.update({
      where: { id: existante.id },
      data: { montant: Math.round((Number(existante.montant) + montant) * 100) / 100 },
    });
  } else {
    await tx.depenseLigne.create({
      data: { retourCaisseId: retourId, montant, objet: "Dépenses non détaillées", date, justification: "SANS_PIECE", commentaire },
    });
  }
}

/** Retire `montant` des lignes génériques du retour ; false si le "non détaillé" est insuffisant. */
async function retirerDuNonDetaille(tx: TxClient, retourId: string, montant: number): Promise<boolean> {
  const generiques = await tx.depenseLigne.findMany({
    where: { retourCaisseId: retourId, objet: "Dépenses non détaillées", motifNonJustifie: null },
    orderBy: { createdAt: "asc" },
  });
  const total = generiques.reduce((s, g) => s + Number(g.montant), 0);
  if (Math.round(montant * 100) > Math.round(total * 100)) return false;
  let aRetirer = montant;
  for (const g of generiques) {
    if (aRetirer <= 0) break;
    const m = Number(g.montant);
    if (m <= aRetirer) {
      await tx.depenseLigne.delete({ where: { id: g.id } });
      aRetirer = Math.round((aRetirer - m) * 100) / 100;
    } else {
      await tx.depenseLigne.update({ where: { id: g.id }, data: { montant: Math.round((m - aRetirer) * 100) / 100 } });
      aRetirer = 0;
    }
  }
  return true;
}

function revaliderCorrection(demandeId: string, retourId: string) {
  revalidatePath("/treso/finance/retours");
  revalidatePath(`/treso/finance/retours/${retourId}`);
  revalidatePath(`/treso/demandes/${demandeId}`);
  revalidatePath(`/treso/finance/demandes/${demandeId}`);
  revalidatePath("/treso/finance", "layout");
  publishDataChanged();
}

/**
 * Correction d'un retour RÉCEPTIONNÉ signalé en erreur, sens "argent qui rentre" (voir CLAUDE.md
 * "Correction d'un retour signalé") : le collaborateur doit rendre PLUS que ce qui a déjà été
 * réceptionné. Déclare un retour COMPLÉMENTAIRE (nouveau RetourCaisse, réceptionné ensuite par le
 * cycle normal, avec sa propre écriture JournalCaisse). Le retour d'origine et son écriture de caisse
 * ne sont jamais modifiés ; seule sa ligne "non détaillé" est réduite pour garder le Solde à
 * régulariser juste. Assistant Finance seul. Le montant est TOUJOURS recalculé côté serveur :
 * montant proposé du signalement − montant déjà réceptionné sur le retour signalé.
 */
export async function declarerRetourComplementaireAction(retourId: string): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.receptionner_retour")) {
    return { status: "error", message: "Action non autorisée." };
  }
  const retour = await prisma.retourCaisse.findUnique({
    where: { id: retourId },
    include: { reglement: { include: { demande: true, retours: true } }, signalements: { where: { estResolu: false } } },
  });
  if (!retour) return { status: "error", message: "Retour de caisse introuvable." };
  const signalement = retour.signalements[0];
  if (!signalement || signalement.montantPropose == null) {
    return { status: "error", message: "Aucun signalement actif avec un montant proposé sur ce retour." };
  }
  if (!retour.estReceptionne) {
    return { status: "error", message: "Ce retour n'est pas encore réceptionné : corrigez-le directement." };
  }
  if (retour.reglement.mode !== "CAISSE") {
    return { status: "error", message: "Le retour complémentaire ne s'applique qu'à un règlement Caisse." };
  }
  if (retour.reglement.demande.statut === "CLOTUREE" && !retour.motifReouvertureExceptionnelle) {
    return { status: "error", message: "Cette demande est clôturée : aucune correction n'est possible." };
  }
  if (retour.reglement.retours.some((r) => !r.estReceptionne)) {
    return { status: "error", message: "Un retour est déjà en attente de réception sur ce règlement : réceptionnez-le d'abord." };
  }
  // Écart sur le "reçu net" (réceptionné + compléments déjà déclarés − remboursements) : le signalement reste actif
  // après une régularisation, jamais deux fois le même écart.
  const recuNet = await getRecuNetSignalement(retourId, signalement.id);
  const ecartCentimes = Math.round(Number(signalement.montantPropose) * 100) - Math.round(recuNet * 100);
  if (ecartCentimes <= 0) {
    return { status: "error", message: "Aucun retour complémentaire à déclarer : le montant proposé est déjà atteint (ou une régularisation de caisse a déjà été faite pour ce signalement)." };
  }
  const ecart = ecartCentimes / 100;
  const demandeId = retour.reglement.demandeId;

  const ok = await prisma.$transaction(async (tx) => {
    if (!(await retirerDuNonDetaille(tx, retourId, ecart))) return false;
    const complement = await tx.retourCaisse.create({
      data: {
        reglementId: retour.reglementId,
        declarantId: session.user.id,
        montantARetourner: ecart,
        creeParAssistant: true,
        signalementOrigineId: signalement.id,
        dateRetour: new Date(),
      },
    });
    // Le signalement N'EST PAS résolu ici : seule la correction du détail (`detaillerDepensesRetourAction`) le résout.
    await tx.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: demandeId,
        action: "retour_complementaire_signalement",
        detail: `Régularisation du signalement du retour de caisse (montant proposé : ${Number(signalement.montantPropose).toLocaleString("fr-FR")} FCFA, déjà réceptionné : ${Number(retour.montantARetourner).toLocaleString("fr-FR")} FCFA) : retour complémentaire de ${ecart.toLocaleString("fr-FR")} FCFA déclaré par ${session.user.fullName}, à réceptionner. Le retour d'origine reste inchangé (réf. retour complémentaire : ${complement.id}).`,
        userId: session.user.id,
      },
    });
    return true;
  });
  if (!ok) {
    return {
      status: "error",
      message: `Le détail déjà saisi couvre trop du total dépensé : il faut libérer au moins ${ecart.toLocaleString("fr-FR")} FCFA en "non détaillé" (corrigez d'abord le détail) avant de déclarer le retour complémentaire.`,
    };
  }
  revaliderCorrection(demandeId, retourId);
  return { status: "success", message: `Retour complémentaire de ${ecart.toLocaleString("fr-FR")} FCFA déclaré — à réceptionner.` };
}

const remboursementSchema = z.object({
  montant: z.coerce.number().positive("Le montant doit être supérieur à 0."),
  motif: z.string().trim().min(10, "Le motif est obligatoire (10 caractères minimum)."),
  pieceJointeUrl: z.string().trim().min(1, "Le justificatif est obligatoire."),
});

/**
 * Sens "argent qui sort" : le collaborateur a trop rendu. L'Assistant Finance PROPOSE un
 * remboursement (pièce jointe obligatoire) ; aucune écriture de caisse avant validation du
 * Responsable Finance. Montant plafonné à (montant réceptionné − montant proposé du signalement).
 */
export async function proposerRemboursementRetourAction(
  retourId: string,
  montant: number,
  motif: string,
  pieceJointeUrl: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.receptionner_retour")) {
    return { status: "error", message: "Action non autorisée." };
  }
  const parsed = remboursementSchema.safeParse({ montant, motif, pieceJointeUrl });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0].message };

  const retour = await prisma.retourCaisse.findUnique({
    where: { id: retourId },
    include: {
      reglement: { include: { demande: true } },
      signalements: { where: { estResolu: false } },
      remboursements: { where: { statut: "EN_ATTENTE_VALIDATION" } },
    },
  });
  if (!retour) return { status: "error", message: "Retour de caisse introuvable." };
  const signalement = retour.signalements[0];
  if (!signalement || signalement.montantPropose == null) {
    return { status: "error", message: "Aucun signalement actif avec un montant proposé sur ce retour." };
  }
  if (!retour.estReceptionne || retour.reglement.mode !== "CAISSE") {
    return { status: "error", message: "Un remboursement ne s'applique qu'à un retour Caisse déjà réceptionné." };
  }
  if (retour.reglement.demande.statut === "CLOTUREE" && !retour.motifReouvertureExceptionnelle) {
    return { status: "error", message: "Cette demande est clôturée : aucune correction n'est possible." };
  }
  if (retour.remboursements.length > 0) {
    return { status: "error", message: "Un remboursement est déjà en attente de validation pour ce retour." };
  }
  const recuNet = await getRecuNetSignalement(retourId, signalement.id);
  const plafondCentimes = Math.round(recuNet * 100) - Math.round(Number(signalement.montantPropose) * 100);
  if (plafondCentimes <= 0) {
    return { status: "error", message: "Aucun remboursement à proposer : le montant proposé est déjà atteint (ou une régularisation de caisse a déjà été faite pour ce signalement)." };
  }
  if (Math.round(parsed.data.montant * 100) > plafondCentimes) {
    return { status: "error", message: `Le remboursement ne peut pas dépasser ${(plafondCentimes / 100).toLocaleString("fr-FR")} FCFA (montant réceptionné − montant proposé).` };
  }
  const demandeId = retour.reglement.demandeId;

  await prisma.$transaction(async (tx) => {
    const pj = await tx.pieceJointe.create({ data: { url: parsed.data.pieceJointeUrl, demandeId } });
    const rb = await tx.remboursementRetour.create({
      data: {
        retourCaisseId: retourId,
        signalementId: signalement.id,
        montant: parsed.data.montant,
        motif: parsed.data.motif,
        pieceJointeId: pj.id,
        proposeParId: session.user.id,
      },
    });
    await tx.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: demandeId,
        action: "remboursement_retour_propose",
        detail: `Remboursement de ${parsed.data.montant.toLocaleString("fr-FR")} FCFA proposé par ${session.user.fullName} suite au signalement du retour de caisse (montant proposé par le collaborateur : ${Number(signalement.montantPropose).toLocaleString("fr-FR")} FCFA) — motif : ${parsed.data.motif}. En attente de validation du Responsable Finance (réf. ${rb.id}).`,
        userId: session.user.id,
      },
    });
  });
  revaliderCorrection(demandeId, retourId);
  return { status: "success", message: "Remboursement proposé — en attente de validation du Responsable Finance." };
}

function estResponsable(session: NonNullable<Awaited<ReturnType<typeof getSession>>>) {
  return hasPermission(session, "treso.valider_demande") && !hasPermission(session, "treso.approuver_validation_complete");
}

/** Validation (Responsable Finance) : SORTIE de caisse, dépense du retour d'origine relevée du même montant. */
export async function validerRemboursementRetourAction(remboursementId: string): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !estResponsable(session)) return { status: "error", message: "Action non autorisée." };

  const rb = await prisma.remboursementRetour.findUnique({
    where: { id: remboursementId },
    include: { retourCaisse: { include: { reglement: { include: { demande: true } } } } },
  });
  if (!rb) return { status: "error", message: "Remboursement introuvable." };
  if (rb.statut !== "EN_ATTENTE_VALIDATION") return { status: "error", message: "Ce remboursement a déjà été traité." };
  if (rb.proposeParId === session.user.id) {
    return { status: "error", message: "Séparation des tâches : vous ne pouvez pas valider votre propre proposition." };
  }
  const montant = Number(rb.montant);
  const solde = await getSoldeCaisse();
  if (Math.round(montant * 100) > Math.round(solde * 100)) {
    return {
      status: "error",
      message: `Solde de caisse insuffisant : ${solde.toLocaleString("fr-FR")} FCFA disponibles pour un remboursement de ${montant.toLocaleString("fr-FR")} FCFA — réalimentez la caisse avant de valider.`,
    };
  }
  const demande = rb.retourCaisse.reglement.demande;
  const maintenant = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.remboursementRetour.update({
      where: { id: remboursementId },
      data: { statut: "VALIDE", valideParId: session.user.id, valideAt: maintenant },
    });
    await tx.journalCaisse.create({
      data: {
        type: "SORTIE",
        montant,
        source: "remboursement_retour",
        refId: remboursementId,
        demandeId: demande.id,
        userId: session.user.id,
      },
    });
    // Ligne DÉDIÉE (jamais fusionnée dans "Dépenses non détaillées") avec un motif renseigné : elle est ainsi éligible à
    // `justifierDepenseApresReceptionAction` et reprise comme une entrée normale par le formulaire de détail. Le signalement
    // N'EST PAS résolu ici : l'argent (remboursement) et la documentation (détail) sont deux choses séparées.
    await tx.depenseLigne.create({
      data: {
        retourCaisseId: rb.retourCaisseId,
        montant,
        objet: "Dépense complémentaire (signalement)",
        date: rb.retourCaisse.dateRetour ?? rb.retourCaisse.createdAt,
        justification: "SANS_PIECE",
        motifNonJustifie: "Dépense complémentaire constatée suite au signalement du collaborateur (remboursement validé)",
        motifNonJustifieParId: session.user.id,
        motifNonJustifieAt: maintenant,
        commentaire: "Ajoutée à la validation du remboursement : justifiable après coup (pièce jointe).",
      },
    });
    await tx.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: demande.id,
        action: "remboursement_retour_valide",
        detail: `Remboursement de ${montant.toLocaleString("fr-FR")} FCFA validé par ${session.user.fullName} (sortie de caisse) en réponse au signalement du retour de caisse ; le retour d'origine et son écriture restent inchangés (réf. ${remboursementId}).`,
        userId: session.user.id,
      },
    });
  });
  revaliderCorrection(demande.id, rb.retourCaisseId);
  await notify({
    userId: demande.createurId,
    titre: "Remboursement de caisse validé",
    message: `Un remboursement de ${montant.toLocaleString("fr-FR")} FCFA vous est accordé le ${maintenant.toLocaleDateString("fr-FR")} sur votre demande ${demande.reference}.`,
    lien: `/treso/demandes/${demande.id}`,
    priority: "IMPORTANT",
    category: "TRESORERIE",
  });
  return { status: "success", message: "Remboursement validé — sortie de caisse enregistrée." };
}

/** Rejet (Responsable Finance), motif obligatoire ; le signalement reste actif, l'Assistant peut re-proposer. */
export async function rejeterRemboursementRetourAction(remboursementId: string, motifRejet: string): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !estResponsable(session)) return { status: "error", message: "Action non autorisée." };
  const parsedMotif = z.string().trim().min(3, "Le motif de rejet est obligatoire (3 caractères minimum).").safeParse(motifRejet);
  if (!parsedMotif.success) return { status: "error", message: parsedMotif.error.issues[0].message };

  const rb = await prisma.remboursementRetour.findUnique({
    where: { id: remboursementId },
    include: { retourCaisse: { include: { reglement: true } } },
  });
  if (!rb) return { status: "error", message: "Remboursement introuvable." };
  if (rb.statut !== "EN_ATTENTE_VALIDATION") return { status: "error", message: "Ce remboursement a déjà été traité." };
  if (rb.proposeParId === session.user.id) {
    return { status: "error", message: "Séparation des tâches : vous ne pouvez pas traiter votre propre proposition." };
  }
  const demandeId = rb.retourCaisse.reglement.demandeId;
  await prisma.$transaction([
    prisma.remboursementRetour.update({
      where: { id: remboursementId },
      data: { statut: "REJETE", valideParId: session.user.id, valideAt: new Date(), motifRejet: parsedMotif.data },
    }),
    prisma.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: demandeId,
        action: "remboursement_retour_rejete",
        detail: `Remboursement de ${Number(rb.montant).toLocaleString("fr-FR")} FCFA rejeté par ${session.user.fullName} — motif : ${parsedMotif.data}.`,
        userId: session.user.id,
      },
    }),
  ]);
  revaliderCorrection(demandeId, rb.retourCaisseId);
  return { status: "success", message: "Remboursement rejeté." };
}

/**
 * Justifie APRÈS COUP une "dépense sans pièce formelle" d'un retour (typiquement déjà réceptionné) :
 * l'Assistant Finance joint la pièce, la ligne passe à "Dépense justifiée". Le montant, le retour et
 * l'écriture de caisse ne changent pas ; seul le statut de justification (donc les totaux "sans pièce
 * formelle" et le suivi des dépenses non justifiées) évolue. Historisé avec l'ancien motif.
 */
export async function justifierDepenseApresReceptionAction(
  depenseLigneId: string,
  pieceJointeUrl: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.receptionner_retour")) {
    return { status: "error", message: "Action non autorisée." };
  }
  const parsedUrl = z.string().trim().min(1, "La pièce jointe est obligatoire pour justifier la dépense.").safeParse(pieceJointeUrl);
  if (!parsedUrl.success) return { status: "error", message: parsedUrl.error.issues[0].message };

  const ligne = await prisma.depenseLigne.findUnique({
    where: { id: depenseLigneId },
    include: { pieceJointe: true, retourCaisse: { include: { reglement: { include: { demande: true } } } } },
  });
  if (!ligne) return { status: "error", message: "Ligne de dépense introuvable." };
  if (ligne.justification !== "SANS_PIECE" || !ligne.motifNonJustifie) {
    return { status: "error", message: "Seule une dépense sans pièce formelle peut être justifiée après coup." };
  }
  if (ligne.pieceJointe) {
    return { status: "error", message: "Cette ligne possède déjà une pièce jointe." };
  }
  const retour = ligne.retourCaisse;
  const demande = retour.reglement.demande;
  if (demande.statut === "CLOTUREE" && !retour.motifReouvertureExceptionnelle) {
    return { status: "error", message: "Cette demande est clôturée : la justification n'est plus modifiable." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.pieceJointe.create({ data: { url: parsedUrl.data, demandeId: demande.id, depenseLigneId } });
    await tx.depenseLigne.update({
      where: { id: depenseLigneId },
      data: { justification: "FACTURE", motifNonJustifie: null, motifNonJustifieParId: null, motifNonJustifieAt: null },
    });
    await tx.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: demande.id,
        action: "justification_apres_reception",
        detail: `Dépense « ${ligne.objet} » (${Number(ligne.montant).toLocaleString("fr-FR")} FCFA) justifiée après coup par ${session.user.fullName} : pièce jointe ajoutée (ancien motif « sans pièce formelle » : ${ligne.motifNonJustifie}). Retour ${retour.estReceptionne ? "déjà réceptionné" : "non réceptionné"} ; montant et écriture de caisse inchangés.`,
        userId: session.user.id,
      },
    });
  });
  revaliderCorrection(demande.id, retour.id);
  return { status: "success", message: "Dépense justifiée : pièce jointe ajoutée." };
}

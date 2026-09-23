"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { notifierParPermission } from "@/lib/notifications";
import { calculerMontantARetournerNet, prisma } from "backend";

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
  motifReouverture?: string
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
  if (reglement.mode !== "CAISSE" || !reglement.estConfirme || reglement.estAnnule) {
    return { status: "error", message: "Ce règlement n'est pas éligible à un retour de caisse." };
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
  const restant = await calculerMontantARetournerNet({ reglementId, totalDepensesNouvelles: 0 });
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
  if (Math.round(nouveauTotal * 100) !== Math.round(montantCible * 100)) {
    const ecart = nouveauTotal - montantCible;
    return {
      status: "error",
      message: `La somme des lignes (${nouveauTotal.toLocaleString("fr-FR")} FCFA) ne correspond pas au total dépensé de ce retour (${montantCible.toLocaleString("fr-FR")} FCFA) — écart de ${Math.abs(ecart).toLocaleString("fr-FR")} FCFA ${ecart > 0 ? "en trop" : "manquant"}.`,
    };
  }

  const demandeId = retour.reglement.demandeId;
  const dateLignes = retour.dateRetour ?? retour.createdAt;

  await prisma.$transaction(async (tx) => {
    await tx.depenseLigne.deleteMany({ where: { retourCaisseId: retourId } });

    for (const l of parsedLignes.data) {
      await tx.depenseLigne.create({
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
    }

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
        detail: signalementActif
          ? `Détail du retour corrigé par l'Assistant Finance suite au signalement du collaborateur (${parsedLignes.data.length} ligne(s), ${nouveauTotal.toLocaleString("fr-FR")} FCFA) — signalement résolu.`
          : `Détail réel du retour renseigné par l'Assistant Finance (${parsedLignes.data.length} ligne(s), ${nouveauTotal.toLocaleString("fr-FR")} FCFA).`,
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
 * la ligne apparaisse dans le suivi "Dépenses non justifiées"
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

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { prisma } from "@/lib/prisma";
import { calculerStatutDemande, getEcart, STATUTS_VALIDATION_COMPLETE } from "@/lib/tresorerie";
import { fieldErrorsFromZod, type ActionState } from "@/lib/validation";

const categorisationSchema = z.object({
  demandeId: z.string().min(1),
  categorieId: z.string().min(1, "Catégorie requise"),
  objetId: z.string().min(1, "Objet requis"),
});

/**
 * Renseigne catégorie/objet/budget d'une demande. Réservée à
 * `treso.categoriser_demande`.
 *
 * Défense en profondeur (règle impérative du cahier des charges) : le
 * statut EN_ATTENTE est revérifié ici, côté serveur, juste avant l'écriture
 * — jamais uniquement via l'UI qui ne propose le formulaire que dans ce
 * cas. Le statut a pu changer entre l'affichage de la page et la
 * soumission (ex: validée entre-temps par un autre utilisateur Finance).
 * Une fois VALIDEE, ces champs sont définitivement verrouillés, y compris
 * pour Finance.
 */
export async function categoriserDemandeAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.categoriser_demande")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsed = categorisationSchema.safeParse({
    demandeId: formData.get("demandeId"),
    categorieId: formData.get("categorieId"),
    objetId: formData.get("objetId"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const { demandeId, categorieId, objetId } = parsed.data;

  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (demande.statut !== "EN_ATTENTE_VALIDATION") {
    return {
      status: "error",
      message: `Cette demande n'est plus modifiable (statut actuel : ${demande.statut}).`,
    };
  }

  const objet = await prisma.objet.findUnique({ where: { id: objetId }, include: { categorie: true } });
  if (!objet || objet.categorieId !== categorieId) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: { objetId: "Cet objet n'appartient pas à la catégorie sélectionnée." },
    };
  }

  await prisma.demande.update({
    where: { id: demandeId },
    data: { categorieId, objetId },
  });

  await prisma.historiqueEntry.create({
    data: {
      entity: "Demande",
      entityId: demandeId,
      action: "CATEGORISER",
      detail: `Catégorie « ${objet.categorie.label} », objet « ${objet.label} »`,
      userId: session.user.id,
    },
  });

  revalidatePath("/treso/finance/demandes");
  revalidatePath(`/treso/finance/demandes/${demandeId}`);
  publishDataChanged();

  return { status: "success", message: "Catégorisation enregistrée." };
}

type SimpleActionResult = { status: "success" | "error"; message: string };

function revalidateDemandePaths(demandeId: string) {
  revalidatePath("/treso/finance/demandes");
  revalidatePath(`/treso/finance/demandes/${demandeId}`);
  revalidatePath("/treso/demandes");
  revalidatePath(`/treso/demandes/${demandeId}`);
  // Ticket 8 : validation/rejet/clôture changent la répartition des
  // demandes VALIDEE — revalider tout l'espace Finance (dashboard + listes
  // "à décaisser"/"à régulariser") en une fois via `type: "layout"`.
  revalidatePath("/treso/finance", "layout");
  // Rafraîchissement en temps réel (voir CLAUDE.md) : publié ici une seule
  // fois pour tous les appelants de ce helper, plutôt que dupliqué à chaque
  // site d'appel.
  publishDataChanged();
}

const montantValidationSchema = z.coerce.number().positive("Le montant doit être supérieur à 0");

/**
 * Enregistre une étape de validation (initiale totale/partielle, ou
 * complémentaire) : met à jour `montantValide`, crée l'entrée d'historique
 * dédiée à CETTE étape précise (montant validé à cette occasion + cumul),
 * puis appelle `calculerStatutDemande` pour déduire le nouveau statut à
 * partir des montants réels — jamais fixé à la main ici. Partagée par les
 * trois Server Actions de validation ci-dessous.
 */
async function enregistrerValidation(
  demandeId: string,
  userId: string,
  montantValideCumule: number,
  montantCetteEtape: number,
  action: "validation" | "validation_complementaire"
): Promise<void> {
  await prisma.$transaction([
    prisma.demande.update({
      where: { id: demandeId },
      data: { montantValide: montantValideCumule },
    }),
    prisma.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: demandeId,
        action,
        detail: `Montant validé à cette étape : ${montantCetteEtape.toLocaleString("fr-FR")} FCFA (cumul validé : ${montantValideCumule.toLocaleString("fr-FR")} FCFA)`,
        userId,
      },
    }),
  ]);

  await calculerStatutDemande(demandeId);
}

/**
 * Valide TOTALEMENT une demande `EN_ATTENTE_VALIDATION` : `montantValide`
 * est porté au montant demandé en une seule fois. Réservée à
 * `treso.valider_demande`. Défense en profondeur : le statut est revérifié
 * ici juste avant l'écriture (même principe que `categoriserDemandeAction`).
 *
 * Pas de "dévalidation" : une fois le montant entièrement validé, il n'y a
 * plus d'action pour revenir en arrière sur ce montant (seuls le rejet —
 * avant toute validation — et la clôture d'une phase ultérieure ferment le
 * dossier).
 */
export async function validerTotalementAction(demandeId: string): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.valider_demande")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (demande.statut !== "EN_ATTENTE_VALIDATION") {
    return {
      status: "error",
      message: `Cette demande n'est plus modifiable (statut actuel : ${demande.statut}).`,
    };
  }

  const montantDemande = Number(demande.montant);
  await enregistrerValidation(demandeId, session.user.id, montantDemande, montantDemande, "validation");
  revalidateDemandePaths(demandeId);

  return { status: "success", message: `Demande ${demande.reference} validée totalement.` };
}

/**
 * Valide PARTIELLEMENT une demande `EN_ATTENTE_VALIDATION`, pour un montant
 * inférieur au montant demandé.
 *
 * Règle impérative : le montant validé ne peut JAMAIS dépasser le montant
 * demandé — un montant strictement supérieur est **refusé** côté serveur
 * (jamais plafonné silencieusement). Cas limite documenté : un montant
 * EXACTEMENT égal au montant demandé n'est plus une validation "partielle"
 * au sens strict, mais reste accepté et appliqué comme une validation
 * TOTALE (redirection de la logique), plutôt que refusé pour une saisie par
 * ailleurs légitime — évite un aller-retour inutile entre les deux boutons
 * pour ce cas précis.
 */
export async function validerPartiellementAction(
  demandeId: string,
  montant: number
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.valider_demande")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsedMontant = montantValidationSchema.safeParse(montant);
  if (!parsedMontant.success) {
    return { status: "error", message: parsedMontant.error.issues[0].message };
  }

  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (demande.statut !== "EN_ATTENTE_VALIDATION") {
    return {
      status: "error",
      message: `Cette demande n'est plus modifiable (statut actuel : ${demande.statut}).`,
    };
  }

  const montantDemande = Number(demande.montant);

  // Règle impérative : le montant validé ne peut JAMAIS dépasser le montant
  // demandé — un montant strictement supérieur est refusé, jamais plafonné
  // silencieusement.
  if (Math.round(parsedMontant.data * 100) > Math.round(montantDemande * 100)) {
    return {
      status: "error",
      message: `Le montant (${parsedMontant.data.toLocaleString("fr-FR")} FCFA) dépasse le montant demandé (${montantDemande.toLocaleString("fr-FR")} FCFA).`,
    };
  }

  const estFinalementTotale = Math.round(parsedMontant.data * 100) >= Math.round(montantDemande * 100);

  await enregistrerValidation(demandeId, session.user.id, parsedMontant.data, parsedMontant.data, "validation");
  revalidateDemandePaths(demandeId);

  return {
    status: "success",
    message: `Demande ${demande.reference} validée ${estFinalementTotale ? "totalement" : "partiellement"} (${parsedMontant.data.toLocaleString("fr-FR")} FCFA).`,
  };
}

/**
 * Validation COMPLÉMENTAIRE sur le reliquat d'une demande déjà
 * `PARTIELLEMENT_VALIDEE` — peut être exécutée par le même validateur ou un
 * autre habilité (`treso.valider_demande`), aucune restriction sur
 * l'auteur de la validation initiale. Le montant complémentaire ne peut
 * jamais faire dépasser le montant demandé une fois ajouté au montant déjà
 * validé (contrôle serveur, pas seulement l'UI qui plafonne déjà la saisie).
 */
export async function validerComplementaireAction(
  demandeId: string,
  montant: number
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.valider_demande")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsedMontant = montantValidationSchema.safeParse(montant);
  if (!parsedMontant.success) {
    return { status: "error", message: parsedMontant.error.issues[0].message };
  }

  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (demande.statut !== "PARTIELLEMENT_VALIDEE") {
    return {
      status: "error",
      message: `Une validation complémentaire n'est possible que sur une demande partiellement validée (statut actuel : ${demande.statut}).`,
    };
  }
  if (demande.reliquatRejete) {
    return {
      status: "error",
      message: "Le reliquat de cette demande a été rejeté, aucune validation complémentaire n'est plus possible.",
    };
  }

  const montantDemande = Number(demande.montant);
  const montantValideActuel = Number(demande.montantValide ?? 0);
  const montantRestant = montantDemande - montantValideActuel;

  if (Math.round(parsedMontant.data * 100) > Math.round(montantRestant * 100)) {
    return {
      status: "error",
      message: `Le montant complémentaire (${parsedMontant.data.toLocaleString("fr-FR")} FCFA) dépasse le reliquat à valider (${montantRestant.toLocaleString("fr-FR")} FCFA).`,
    };
  }

  const montantValideFinal = montantValideActuel + parsedMontant.data;
  await enregistrerValidation(
    demandeId,
    session.user.id,
    montantValideFinal,
    parsedMontant.data,
    "validation_complementaire"
  );
  revalidateDemandePaths(demandeId);

  return {
    status: "success",
    message: `Demande ${demande.reference} : validation complémentaire de ${parsedMontant.data.toLocaleString("fr-FR")} FCFA enregistrée.`,
  };
}

const motifRejetReliquatSchema = z
  .string()
  .trim()
  .min(3, "Le motif est obligatoire (3 caractères minimum)");

/**
 * Rejette le reliquat NON encore validé d'une demande `PARTIELLEMENT_VALIDEE`
 * — le seul chemin qui manquait au circuit de validation partielle
 * (jusqu'ici, une demande partiellement validée ne pouvait recevoir qu'une
 * validation complémentaire, jamais un rejet du reste). Réservée à
 * `treso.valider_demande` (Finance ET DG, même permission que la validation
 * elle-même — pas de restriction sur qui a effectué la validation initiale).
 *
 * **N'affecte JAMAIS `montantValide` ni le `statut`** : la part déjà
 * validée reste acquise et suit son cours normal (règlement, clôture),
 * exactement comme documenté pour `rejeterValidationCompleteAction` — une
 * trace de décision, pas une réécriture du montant. Seul effet concret :
 * `validerComplementaireAction` refuse désormais toute nouvelle tentative
 * sur cette demande (voir la garde ajoutée ci-dessus).
 *
 * Motif obligatoire, revalidé côté serveur. Défense en profondeur : refusée
 * si la demande n'est pas `PARTIELLEMENT_VALIDEE`, ou si son reliquat est
 * déjà rejeté (`reliquatRejete` ne peut être fixé qu'une seule fois — même
 * principe que l'absence de "dévalidation" ailleurs dans le module).
 */
export async function rejeterReliquatAction(
  demandeId: string,
  motif: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.valider_demande")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsedMotif = motifRejetReliquatSchema.safeParse(motif);
  if (!parsedMotif.success) {
    return { status: "error", message: parsedMotif.error.issues[0].message };
  }

  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (demande.statut !== "PARTIELLEMENT_VALIDEE") {
    return {
      status: "error",
      message: `Le rejet du reliquat n'est possible que sur une demande partiellement validée (statut actuel : ${demande.statut}).`,
    };
  }
  if (demande.reliquatRejete) {
    return { status: "error", message: "Le reliquat de cette demande a déjà été rejeté." };
  }

  await prisma.$transaction([
    prisma.demande.update({
      where: { id: demandeId },
      data: { reliquatRejete: true, motifRejetReliquat: parsedMotif.data },
    }),
    prisma.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: demandeId,
        action: "rejet_reliquat",
        detail: parsedMotif.data,
        userId: session.user.id,
      },
    }),
  ]);

  revalidateDemandePaths(demandeId);

  return {
    status: "success",
    message: `Reliquat de la demande ${demande.reference} rejeté — le montant déjà validé suit son cours normal.`,
  };
}

const motifRejetSchema = z
  .string()
  .trim()
  .min(3, "Le motif du rejet est obligatoire (3 caractères minimum)");

/**
 * Rejette une demande. Réservée à `treso.valider_demande` (même permission
 * que valider — la décision valider/rejeter est un seul et même pouvoir).
 * Motif obligatoire (validé ici, jamais uniquement côté client) ; même
 * défense en profondeur sur le statut que les actions de validation
 * ci-dessus.
 *
 * **Choix Phase B, documenté ici et dans CLAUDE.md** : le rejet reste
 * réservé au statut `EN_ATTENTE_VALIDATION` — une demande déjà
 * `PARTIELLEMENT_VALIDEE` ne peut plus être "rejetée" au sens strict. Une
 * fois qu'un montant a été validé (donc potentiellement déjà réglé — les
 * Tickets 4+ n'attendent pas la clôture pour créer un règlement dès que le
 * statut fait partie de `STATUTS_VALIDATION_COMPLETE`), revenir en arrière
 * sur la totalité de la demande n'a plus de sens : le montant déjà validé
 * est acquis. Le seul chemin en avant pour le reliquat est une validation
 * complémentaire (`validerComplementaireAction`) ; aucune action de "rejet
 * du reliquat" n'existe à ce stade — si le validateur souhaite abandonner
 * la partie non encore validée, ce cas restera sans réponse applicative
 * tant qu'une phase ultérieure (clôture/régularisation) n'introduit pas un
 * mécanisme dédié pour l'acter explicitement.
 */
export async function rejeterDemandeAction(
  demandeId: string,
  motif: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.valider_demande")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsedMotif = motifRejetSchema.safeParse(motif);
  if (!parsedMotif.success) {
    return { status: "error", message: parsedMotif.error.issues[0].message };
  }

  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (demande.statut !== "EN_ATTENTE_VALIDATION") {
    return {
      status: "error",
      message: `Cette demande n'est plus modifiable (statut actuel : ${demande.statut}).`,
    };
  }

  await prisma.$transaction([
    prisma.demande.update({
      where: { id: demandeId },
      data: { statut: "REJETEE", motifRejet: parsedMotif.data },
    }),
    prisma.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: demandeId,
        action: "rejet",
        detail: parsedMotif.data,
        userId: session.user.id,
      },
    }),
  ]);

  revalidateDemandePaths(demandeId);

  return { status: "success", message: `Demande ${demande.reference} rejetée.` };
}

const motifClotureSchema = z
  .string()
  .trim()
  .min(3, "Le motif de la clôture partielle est obligatoire (3 caractères minimum)");

/**
 * Clôture une demande VALIDEE. Réservée à `treso.cloturer_demande` (Finance
 * uniquement selon le seed actuel, pas le DG — la garde du layout partagé
 * n'accorde pas cette permission automatiquement, revérifiée ici).
 *
 * Verrouillage DÉFINITIF (même principe que `validerDemandeAction`) : une
 * fois `CLOTUREE_TOTALE` ou `CLOTUREE_PARTIELLE`, plus aucune action n'est
 * possible sur la demande — ni nouveau règlement, ni nouvelle déclaration
 * de retour, ni nouvelle réception, ni re-clôture. Cette Server Action ne
 * fait que fermer son propre statut ; la défense en profondeur côté des
 * AUTRES actions (`creerReglementAction`, `creerRetourCaisseAction`,
 * `receptionnerRetourAction`, `annulerReglementAction`) revérifie chacune
 * `demande.statut === "VALIDEE"` de son côté (voir leurs fichiers
 * respectifs) : le statut CLOTUREE_* les fait toutes échouer naturellement.
 *
 * Clôture totale : motif libre optionnel, stocké dans `motifCloture` à
 * titre de commentaire (pas de validation de longueur). Clôture partielle :
 * motif obligatoire (min 3 caractères), refusé côté serveur sans lui, même
 * si le bouton de confirmation est aussi bloqué côté client si le champ est
 * vide.
 */
export async function cloturerDemandeAction(
  demandeId: string,
  type: "TOTALE" | "PARTIELLE",
  motif?: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.cloturer_demande")) {
    return { status: "error", message: "Action non autorisée." };
  }

  let motifValide: string | null = null;
  if (type === "PARTIELLE") {
    const parsedMotif = motifClotureSchema.safeParse(motif);
    if (!parsedMotif.success) {
      return { status: "error", message: parsedMotif.error.issues[0].message };
    }
    motifValide = parsedMotif.data;
  } else if (motif?.trim()) {
    motifValide = motif.trim();
  }

  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }

  // Verrou de clôture (indépendant du circuit de validation/règlement des
  // Phases B/C, qui reste inchangé — voir `validationCompleteParDG` sur
  // `Demande`) : avant tout le reste, une demande ne peut être clôturée
  // (totale ou partielle) que si le DG a donné son approbation complète,
  // même si Finance a déjà intégralement réglé.
  if (!demande.validationCompleteParDG) {
    return {
      status: "error",
      message: "La clôture nécessite l'approbation complète du DG au préalable.",
    };
  }

  // REFONTE V1 (Phase B) : `VALIDEE` seul ne suffit plus — la validation
  // totale produit désormais VALIDEE_NON_REGLEE/PARTIELLEMENT_REGLEE/REGLEE
  // selon l'avancement du règlement (voir `calculerStatutDemande`). Voir
  // `STATUTS_VALIDATION_COMPLETE` dans src/lib/tresorerie.ts.
  if (!STATUTS_VALIDATION_COMPLETE.includes(demande.statut)) {
    return {
      status: "error",
      message: `Cette demande ne peut pas être clôturée (statut actuel : ${demande.statut}).`,
    };
  }

  const ecart = await getEcart(demandeId);
  const detail =
    type === "PARTIELLE"
      ? motifValide!
      : `Clôture totale — écart au moment de la clôture : ${ecart.toLocaleString("fr-FR")} FCFA${
          motifValide ? ` (${motifValide})` : ""
        }`;

  await prisma.$transaction([
    prisma.demande.update({
      where: { id: demandeId },
      data: {
        // REFONTE V1 (temporaire) : CLOTUREE_TOTALE/CLOTUREE_PARTIELLE
        // fusionnés dans l'unique statut CLOTUREE — voir CLAUDE.md
        // "Refonte V1 en cours". La distinction totale/partielle reste
        // portée par `motifCloture` (rempli seulement pour une clôture
        // partielle avant cette refonte) en attendant la phase de
        // régularisation (EN_ATTENTE_REGULARISATION/REGULARISEE).
        statut: "CLOTUREE",
        motifCloture: motifValide,
      },
    }),
    prisma.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: demandeId,
        action: type === "TOTALE" ? "cloture_totale" : "cloture_partielle",
        detail,
        userId: session.user.id,
      },
    }),
  ]);

  revalidateDemandePaths(demandeId);

  return {
    status: "success",
    message: `Demande ${demande.reference} clôturée${type === "PARTIELLE" ? " (partielle)" : ""}.`,
  };
}

/**
 * Approuve la "validation complète" du DG — verrou de clôture (Ticket 7),
 * totalement indépendant du circuit de validation/règlement des Phases
 * B/C : n'affecte JAMAIS `montantValide` ni l'éligibilité au règlement
 * (`peutEffectuerReglement`, toujours basée uniquement sur `montantValide` /
 * `getResteARegler`), seulement la possibilité de clôturer ensuite. Réservée
 * à `treso.approuver_validation_complete` (DG uniquement selon le seed
 * actuel — jamais Finance, même si Finance a déjà tout réglé).
 *
 * Deux gardes métier avant l'écriture :
 * - `montantValide > 0` — une demande encore `EN_ATTENTE_VALIDATION` (rien
 *   validé) ou `REJETEE` n'a rien de significatif à approuver ici.
 * - Pas de double approbation : `validationCompleteParDG` ne peut être
 *   fixé qu'une seule fois (aucune action de "retrait" n'existe non plus,
 *   même principe que l'absence de "dévalidation").
 */
export async function approuverValidationCompleteAction(demandeId: string): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.approuver_validation_complete")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (demande.montantValide == null || Number(demande.montantValide) <= 0) {
    return {
      status: "error",
      message: "Cette demande n'a encore aucun montant validé — rien à approuver.",
    };
  }
  if (demande.validationCompleteParDG) {
    return { status: "error", message: "La validation complète a déjà été approuvée pour cette demande." };
  }

  await prisma.$transaction([
    prisma.demande.update({
      where: { id: demandeId },
      data: {
        validationCompleteParDG: true,
        dgApprobateurId: session.user.id,
        dgApprouveAt: new Date(),
      },
    }),
    prisma.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: demandeId,
        action: "validation_complete_dg",
        detail: `Validation complète approuvée par ${session.user.fullName}`,
        userId: session.user.id,
      },
    }),
  ]);

  revalidateDemandePaths(demandeId);

  return { status: "success", message: `Validation complète approuvée pour la demande ${demande.reference}.` };
}

const motifValidationCompleteSchema = z
  .string()
  .trim()
  .min(3, "Le motif est obligatoire (3 caractères minimum)");

/**
 * Rejette une demande lors de l'EXAMEN du verrou de clôture (le DG regarde
 * le dossier avant d'approuver et décide qu'il n'est pas encore prêt).
 * **Ne modifie AUCUN champ de la `Demande`** — contrairement à
 * `rejeterDemandeAction` (rejet de la demande elle-même, avant toute
 * validation), ce rejet-ci porte uniquement sur l'approbation DG : la
 * demande reste dans son statut courant, toujours visible dans
 * "Validations complètes en attente" (rien n'a structurellement changé,
 * il n'y a rien à "annuler" pour la faire réapparaître). Trace purement
 * informative — une `HistoriqueEntry` supplémentaire qui vient s'ajouter,
 * jamais remplacer les précédentes, pour que Finance comprenne pourquoi le
 * dossier n'avance pas et corrige ce qui doit l'être avant un nouvel
 * examen par le DG.
 *
 * Règle impérative de traçabilité (exigence explicite : "une histoire
 * d'argent", rien n'est jamais supprimé ni écrasé) : aucune action de
 * cette fonctionnalité (approbation, rejet, annulation) ne supprime ni ne
 * modifie une `HistoriqueEntry` existante — chacune s'ajoute à la suite,
 * avec son auteur, sa date et son motif.
 */
export async function rejeterValidationCompleteAction(
  demandeId: string,
  motif: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.approuver_validation_complete")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsedMotif = motifValidationCompleteSchema.safeParse(motif);
  if (!parsedMotif.success) {
    return { status: "error", message: parsedMotif.error.issues[0].message };
  }

  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (demande.validationCompleteParDG) {
    return {
      status: "error",
      message: "Cette demande a déjà été approuvée — utilisez plutôt l'annulation de l'approbation.",
    };
  }

  await prisma.historiqueEntry.create({
    data: {
      entity: "Demande",
      entityId: demandeId,
      action: "rejet_validation_complete",
      detail: parsedMotif.data,
      userId: session.user.id,
    },
  });

  revalidateDemandePaths(demandeId);
  revalidatePath("/treso/finance/validations-attente");

  return {
    status: "success",
    message: `Examen de la demande ${demande.reference} : motif de rejet enregistré.`,
  };
}

/**
 * Annule une approbation DG déjà donnée (le DG s'est trompé, ou revient sur
 * sa décision). Contrairement au rejet ci-dessus, cette action modifie bien
 * la `Demande` — elle redevient éligible à la clôture uniquement après une
 * nouvelle approbation — mais **jamais en supprimant ou en réécrivant
 * l'entrée `validation_complete_dg` d'origine** : celle-ci reste intacte et
 * visible dans l'historique, la nouvelle entrée `annulation_validation_complete`
 * vient s'ajouter à la suite. L'historique complet permet ainsi de
 * reconstituer : approuvé le [date] par [DG], puis annulé le [date] par
 * [DG] avec motif [X] — jamais un état réécrit silencieusement.
 *
 * Refusée si la demande est déjà `CLOTUREE` : la clôture a été actée sur la
 * base de cette approbation (voir `cloturerDemandeAction`, qui exige
 * `validationCompleteParDG` avant d'accepter) — l'annuler après coup
 * casserait la cohérence d'une clôture déjà définitive. Aucun autre statut
 * n'est bloqué : `peutEffectuerReglement`/le circuit de règlement des
 * Phases B/C ne dépendent jamais de `validationCompleteParDG`, annuler
 * l'approbation ne défait donc aucun règlement déjà confirmé.
 */
export async function annulerValidationCompleteAction(
  demandeId: string,
  motif: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.approuver_validation_complete")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsedMotif = motifValidationCompleteSchema.safeParse(motif);
  if (!parsedMotif.success) {
    return { status: "error", message: parsedMotif.error.issues[0].message };
  }

  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (!demande.validationCompleteParDG) {
    return { status: "error", message: "Cette demande n'a pas encore été approuvée." };
  }
  if (demande.statut === "CLOTUREE") {
    return {
      status: "error",
      message: "Impossible d'annuler : la demande a déjà été clôturée sur la base de cette approbation.",
    };
  }

  await prisma.$transaction([
    prisma.demande.update({
      where: { id: demandeId },
      data: { validationCompleteParDG: false, dgApprobateurId: null, dgApprouveAt: null },
    }),
    prisma.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: demandeId,
        action: "annulation_validation_complete",
        detail: parsedMotif.data,
        userId: session.user.id,
      },
    }),
  ]);

  revalidateDemandePaths(demandeId);
  revalidatePath("/treso/finance/validations-attente");

  return {
    status: "success",
    message: `Approbation annulée pour la demande ${demande.reference} — retour en attente de validation complète.`,
  };
}

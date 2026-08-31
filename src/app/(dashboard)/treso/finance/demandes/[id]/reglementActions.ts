"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calculerStatutDemande, getResteARegler, getTotalRegle, peutEffectuerReglement } from "@/lib/tresorerie";
import { fieldErrorsFromZod, type ActionState } from "@/lib/validation";

type SimpleActionResult = { status: "success" | "error"; message: string };

const montantSchema = z.coerce.number().positive("Le montant doit être supérieur à 0");
const modeSchema = z.enum(["CAISSE", "BANQUE"]);

function revalidateDemande(demandeId: string) {
  revalidatePath(`/treso/finance/demandes/${demandeId}`);
  revalidatePath("/treso/finance/demandes");
  revalidatePath("/treso/demandes");
  // Ticket 8 : le dashboard Finance (et ses listes filtrées "à décaisser" /
  // "à régulariser") dépend du montant réglé — revalider tout l'espace
  // Finance en une fois (`type: "layout"` couvre toutes les routes sous
  // `finance/layout.tsx`) plutôt que d'énumérer chaque sous-route une à une.
  revalidatePath("/treso/finance", "layout");
}

const creerReglementSchema = z.object({
  demandeId: z.string().min(1),
  montant: montantSchema,
  mode: modeSchema,
});

/**
 * Crée un règlement en brouillon (`estConfirme: false`). Réservée à
 * `treso.effectuer_reglement`. Le montant ne peut pas dépasser le reste à
 * régler — revérifié ici même si le formulaire ne devrait normalement pas
 * le permettre (le reste à régler a pu changer depuis l'affichage de la
 * page : autre règlement confirmé entre-temps par un collègue).
 *
 * REFONTE V1 / Phase C (voir CLAUDE.md "Refonte V1 en cours") : l'éligibilité
 * n'est plus liée au statut `VALIDEE` (ni à `STATUTS_VALIDATION_COMPLETE`),
 * mais à `peutEffectuerReglement` — `montantValide > 0` ET reste à régler
 * (calculé sur `montantValide`, pas le montant demandé) `> 0`. Une demande
 * `PARTIELLEMENT_VALIDEE` est donc éligible dès sa validation partielle,
 * sans attendre le reliquat (cahier des charges section 4).
 */
export async function creerReglementAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.effectuer_reglement")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsed = creerReglementSchema.safeParse({
    demandeId: formData.get("demandeId"),
    montant: formData.get("montant"),
    mode: formData.get("mode"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const { demandeId, montant, mode } = parsed.data;

  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (!(await peutEffectuerReglement(demandeId))) {
    return {
      status: "error",
      message: "Cette demande n'est pas éligible au règlement (aucun montant validé restant à régler).",
    };
  }

  const reste = await getResteARegler(demandeId);
  if (montant > reste) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: {
        montant: `Le montant dépasse le reste à régler (${reste.toLocaleString("fr-FR")} FCFA).`,
      },
    };
  }

  await prisma.reglement.create({
    data: { demandeId, montant, mode, auteurId: session.user.id },
  });

  revalidateDemande(demandeId);

  return { status: "success", message: "Règlement créé (brouillon)." };
}

/**
 * Modifie le montant/mode d'un règlement NON confirmé et NON annulé. Mêmes
 * validations que la création. Appelée directement depuis un composant
 * client (pas via `<form>`), comme les actions valider/rejeter du Ticket 3.
 */
export async function modifierReglementAction(
  reglementId: string,
  montant: number,
  mode: "CAISSE" | "BANQUE"
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.effectuer_reglement")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsedMontant = montantSchema.safeParse(montant);
  const parsedMode = modeSchema.safeParse(mode);
  if (!parsedMontant.success || !parsedMode.success) {
    return { status: "error", message: "Montant ou mode invalide." };
  }

  const reglement = await prisma.reglement.findUnique({ where: { id: reglementId } });
  if (!reglement) {
    return { status: "error", message: "Règlement introuvable." };
  }
  if (reglement.estConfirme || reglement.estAnnule) {
    return { status: "error", message: "Ce règlement n'est plus modifiable." };
  }

  if (!(await peutEffectuerReglement(reglement.demandeId))) {
    return { status: "error", message: "Cette demande n'est plus éligible au règlement : modification impossible." };
  }

  const reste = await getResteARegler(reglement.demandeId);
  if (parsedMontant.data > reste) {
    return {
      status: "error",
      message: `Le montant dépasse le reste à régler (${reste.toLocaleString("fr-FR")} FCFA).`,
    };
  }

  await prisma.reglement.update({
    where: { id: reglementId },
    data: { montant: parsedMontant.data, mode: parsedMode.data },
  });

  revalidateDemande(reglement.demandeId);

  return { status: "success", message: "Règlement modifié." };
}

/**
 * Confirme un règlement en brouillon. Réservée à `treso.effectuer_reglement`.
 *
 * Défense en profondeur : revérifie l'éligibilité au règlement
 * (`peutEffectuerReglement`, Phase C), que le règlement n'est ni déjà
 * confirmé ni annulé, et recalcule côté serveur que la confirmation ne
 * ferait pas dépasser **`montantValide`** (jamais le montant demandé, ni
 * confiance dans l'UI). Si `mode = CAISSE`, l'écriture `JournalCaisse`
 * (SORTIE) est créée dans la même transaction que la confirmation — les
 * deux réussissent ou échouent ensemble. Un règlement BANQUE n'a
 * strictement aucun effet sur `JournalCaisse`.
 *
 * `confirmeAt` (Ticket 9) enregistre la date de confirmation elle-même,
 * distincte de `createdAt` (date de création du brouillon) — c'est cette
 * date qui doit apparaître sur le reçu PDF, jamais la date du brouillon.
 *
 * Phase C, Tâche 3 : appelle `calculerStatutDemande` en fin d'action —
 * fait passer le statut à `PARTIELLEMENT_REGLEE`/`REGLEE` (ou laisse
 * `PARTIELLEMENT_VALIDEE` inchangé si la demande n'est pas encore
 * entièrement validée, voir `calculerStatutDemande`).
 */
export async function confirmerReglementAction(reglementId: string): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.effectuer_reglement")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const reglement = await prisma.reglement.findUnique({ where: { id: reglementId } });
  if (!reglement) {
    return { status: "error", message: "Règlement introuvable." };
  }
  if (reglement.estConfirme) {
    return { status: "error", message: "Ce règlement est déjà confirmé." };
  }
  if (reglement.estAnnule) {
    return { status: "error", message: "Ce règlement est annulé, il ne peut pas être confirmé." };
  }

  if (!(await peutEffectuerReglement(reglement.demandeId))) {
    return { status: "error", message: "Cette demande n'est plus éligible au règlement : confirmation impossible." };
  }

  const demande = await prisma.demande.findUniqueOrThrow({ where: { id: reglement.demandeId } });
  const totalConfirme = await getTotalRegle(reglement.demandeId);
  const montantReglement = Number(reglement.montant);
  if (totalConfirme + montantReglement > Number(demande.montantValide)) {
    return {
      status: "error",
      message: "Ce règlement dépasserait le montant validé de la demande — confirmation refusée.",
    };
  }

  await prisma.$transaction([
    prisma.reglement.update({
      where: { id: reglementId },
      data: { estConfirme: true, confirmeAt: new Date() },
    }),
    ...(reglement.mode === "CAISSE"
      ? [
          prisma.journalCaisse.create({
            data: {
              type: "SORTIE",
              montant: reglement.montant,
              source: "reglement_caisse",
              refId: reglementId,
            },
          }),
        ]
      : []),
    prisma.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: reglement.demandeId,
        action: "reglement",
        detail: `Règlement confirmé : ${montantReglement.toLocaleString("fr-FR")} FCFA (${reglement.mode})`,
        userId: session.user.id,
      },
    }),
  ]);

  await calculerStatutDemande(reglement.demandeId);
  revalidateDemande(reglement.demandeId);

  return { status: "success", message: "Règlement confirmé." };
}

const motifAnnulationSchema = z
  .string()
  .trim()
  .min(3, "Le motif de l'annulation est obligatoire (3 caractères minimum)");

/**
 * Annule un règlement confirmé. Réservée à `treso.effectuer_reglement`.
 *
 * Jamais de suppression ni d'édition silencieuse (règle impérative) :
 * l'écriture SORTIE d'origine (si `CAISSE`) n'est ni modifiée ni
 * supprimée — une écriture ENTREE compensatoire neutralise son effet sur
 * le solde, dans le grand livre immuable `JournalCaisse`. Le règlement
 * annulé reste visible dans la liste (statut "Annulé"), jamais supprimé.
 *
 * Défense en profondeur (Ticket 7) : revérifie que la demande n'est ni
 * `CLOTUREE` ni `REJETEE` — une fois clôturée, plus aucune action sur ses
 * règlements n'est possible, y compris une annulation (`estConfirme` ne
 * change jamais après clôture, ce n'était donc pas suffisant à lui seul).
 *
 * **Volontairement PAS `peutEffectuerReglement` ici** (Phase C) : cette
 * garde exigerait un reste à régler > 0 AVANT l'annulation, ce qui
 * bloquerait à tort l'annulation du tout dernier règlement d'une demande
 * `REGLEE` (reste = 0 par définition) — l'annulation est précisément le
 * mécanisme qui doit pouvoir faire repasser le reste au-dessus de 0.
 *
 * Phase C, Tâche 3 : appelle `calculerStatutDemande` en fin d'action — fait
 * revenir le statut à `PARTIELLEMENT_REGLEE`/`VALIDEE_NON_REGLEE` (ou
 * laisse `PARTIELLEMENT_VALIDEE` inchangé) selon le nouveau total réglé.
 */
export async function annulerReglementAction(
  reglementId: string,
  motif: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.effectuer_reglement")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsedMotif = motifAnnulationSchema.safeParse(motif);
  if (!parsedMotif.success) {
    return { status: "error", message: parsedMotif.error.issues[0].message };
  }

  const reglement = await prisma.reglement.findUnique({ where: { id: reglementId }, include: { demande: true } });
  if (!reglement) {
    return { status: "error", message: "Règlement introuvable." };
  }
  if (!reglement.estConfirme) {
    return { status: "error", message: "Seul un règlement confirmé peut être annulé." };
  }
  if (reglement.estAnnule) {
    return { status: "error", message: "Ce règlement est déjà annulé." };
  }
  if (reglement.demande.statut === "CLOTUREE" || reglement.demande.statut === "REJETEE") {
    return {
      status: "error",
      message: `Cette demande n'est plus modifiable (statut actuel : ${reglement.demande.statut}).`,
    };
  }

  await prisma.$transaction([
    prisma.reglement.update({
      where: { id: reglementId },
      data: { estAnnule: true, motifAnnulation: parsedMotif.data },
    }),
    ...(reglement.mode === "CAISSE"
      ? [
          prisma.journalCaisse.create({
            data: {
              type: "ENTREE",
              montant: reglement.montant,
              source: "annulation_reglement_caisse",
              refId: reglementId,
            },
          }),
        ]
      : []),
    prisma.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: reglement.demandeId,
        action: "annulation_reglement",
        detail: parsedMotif.data,
        userId: session.user.id,
      },
    }),
  ]);

  await calculerStatutDemande(reglement.demandeId);
  revalidateDemande(reglement.demandeId);

  return { status: "success", message: "Règlement annulé." };
}

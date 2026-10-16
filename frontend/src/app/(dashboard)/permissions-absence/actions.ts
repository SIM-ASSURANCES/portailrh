"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  bornesMois,
  controlerSaisiePermission,
  deciderPermission,
  evaluerPlafond,
  fieldErrorsFromZod,
  formatJourCivil,
  marquerRetourPermission,
  prisma,
  soumettrePermission,
  transactionAbsence,
  verifierDureeAutorisee,
  colonneDateDepuisJourCivil,
  type ActionPermission,
  type ActionState,
} from "backend";
import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { notifierDecisionPermission, notifierSoumissionPermission } from "@/lib/absences/notifier";

const JOUR = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (AAAA-MM-JJ)");
const HEURE = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format d'heure invalide (HH:MM)");

const demandeSchema = z.object({
  typePermissionId: z.string().min(1, "Veuillez sélectionner un type de permission"),
  date: JOUR,
  heureDepart: HEURE,
  heureRetourPrevue: HEURE,
  motif: z.string().min(5, "Le motif doit comporter au moins 5 caractères").max(500, "Le motif ne doit pas dépasser 500 caractères"),
});

export type DemandePermissionInput = z.infer<typeof demandeSchema>;

function revalider(demandeId?: string) {
  revalidatePath("/permissions-absence");
  revalidatePath("/permissions-absence/a-decider");
  if (demandeId) revalidatePath(`/permissions-absence/${demandeId}`);
  publishDataChanged();
}

// ---------------------------------------------------------------------------------------------------------------------
// Demandeur
// ---------------------------------------------------------------------------------------------------------------------

export async function soumettrePermissionAction(
  input: DemandePermissionInput
): Promise<ActionState<{ id: string; reference: string; avertissement: string | null }>> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Non authentifié." };
  if (!hasPermission(session, "absences.soumettre")) return { status: "error", message: "Action non autorisée." };

  const parsed = demandeSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Formulaire invalide.", fieldErrors: fieldErrorsFromZod(parsed.error) };

  const r = await transactionAbsence((tx) =>
    soumettrePermission(tx, { userId: session.user.id, entree: parsed.data, maintenant: new Date() })
  );
  if (!r.ok) return { status: "error", message: r.erreur, fieldErrors: r.champ ? { [r.champ]: r.erreur } : undefined };

  await notifierSoumissionPermission({
    soumission: r.valeur,
    demandeurNom: session.user.fullName,
    date: parsed.data.date,
    heureDepart: parsed.data.heureDepart,
    heureRetourPrevue: parsed.data.heureRetourPrevue,
    auteurId: session.user.id,
  });
  revalider(r.valeur.id);
  const avertissement = r.valeur.auDelaDuPlafond
    ? `Le plafond mensuel de ce type est atteint (${r.valeur.auDelaDuPlafond.utilise}/${r.valeur.auDelaDuPlafond.plafond}) : la RH devra accorder une dérogation.`
    : r.valeur.alerteCongeRecommande
      ? "Au-delà de 4 heures, un congé est plus adapté."
      : null;
  return {
    status: "success",
    message: r.valeur.statut === "EN_ATTENTE_RESPONSABLE" ? "Votre demande a été transmise à votre responsable." : "Votre demande a été transmise à la RH.",
    data: { id: r.valeur.id, reference: r.valeur.reference, avertissement },
  };
}

export async function marquerRetourPermissionAction(demandeId: string, heureRetourReelle: string): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Non authentifié." };
  const heure = HEURE.safeParse(heureRetourReelle);
  if (!heure.success) return { status: "error", message: "Heure de retour invalide (HH:MM).", fieldErrors: { heureRetourReelle: "Format d'heure invalide (HH:MM)." } };

  const r = await transactionAbsence((tx) =>
    marquerRetourPermission(tx, {
      demandeId: String(demandeId),
      acteurId: session.user.id,
      // La RH marque le retour d'un autre : décision lue sur le rôle.
      peutMarquerPourAutrui: session.rolePermissions.includes("absences.valider_rh"),
      heureRetourReelle: heure.data,
      maintenant: new Date(),
    })
  );
  if (!r.ok) return { status: "error", message: r.erreur, fieldErrors: r.champ ? { [r.champ]: r.erreur } : undefined };
  revalider(r.valeur.id);
  return {
    status: "success",
    message: r.valeur.depassement ? `Retour enregistré (${r.valeur.minutesEcart} min après l'heure prévue).` : "Retour enregistré : la permission est consommée.",
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Décision (responsable, RH, DG selon l'étape : le moteur décide qui, jamais cette action)
// ---------------------------------------------------------------------------------------------------------------------

async function decider(demandeId: string, action: ActionPermission, message: string): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Non authentifié." };

  const r = await transactionAbsence((tx) =>
    deciderPermission(tx, {
      demandeId: String(demandeId),
      // Permissions du RÔLE, jamais les délégations : décider ne se délègue pas.
      acteur: { id: session.user.id, rolePermissions: session.rolePermissions },
      action,
      peutAnnulerApresDebut: hasPermission(session, "absences.annuler"),
      maintenant: new Date(),
    })
  );
  if (!r.ok) return { status: "error", message: r.erreur, fieldErrors: r.champ ? { [r.champ]: r.erreur } : undefined };

  await notifierDecisionPermission({ decision: r.valeur, acteurId: session.user.id, acteurNom: session.user.fullName });
  revalider(r.valeur.id);
  return { status: "success", message: r.valeur.exceptionPlafond ? "Permission accordée avec dérogation au plafond." : message };
}

/** `exceptionPlafond` : motif de la dérogation, seulement à l'étape RH quand le plafond mensuel est atteint. */
export async function approuverPermissionAction(demandeId: string, exceptionPlafond?: string): Promise<ActionState> {
  return decider(
    demandeId,
    { type: "APPROUVER", ...(exceptionPlafond ? { exceptionPlafond: String(exceptionPlafond) } : {}) },
    "Décision enregistrée : permission approuvée."
  );
}

export async function rejeterPermissionAction(demandeId: string, motif: string): Promise<ActionState> {
  return decider(demandeId, { type: "REJETER", motif: String(motif ?? "") }, "Permission rejetée.");
}

export async function annulerPermissionAction(demandeId: string, motif: string): Promise<ActionState> {
  return decider(demandeId, { type: "ANNULER", motif: String(motif ?? "") }, "Permission annulée.");
}

// ---------------------------------------------------------------------------------------------------------------------
// Types de permission (durée maximale, plafond mensuel)
// ---------------------------------------------------------------------------------------------------------------------

const typeSchema = z.object({
  label: z.string().trim().min(3, "Le libellé doit comporter au moins 3 caractères").max(120),
  dureeMaxHeures: z.number().int("Nombre entier d'heures").min(1, "Au moins 1 heure").max(24, "Au plus 24 heures"),
  plafondMensuel: z.number().int("Nombre entier").min(1, "Au moins 1 par mois").max(60),
  justificatifRecommande: z.boolean(),
});

async function ecrireType(id: string | null, input: z.infer<typeof typeSchema>): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Non authentifié." };
  if (!hasPermission(session, "absences.parametrer")) return { status: "error", message: "Action non autorisée." };
  const parsed = typeSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Formulaire invalide.", fieldErrors: fieldErrorsFromZod(parsed.error) };

  try {
    const type = id ? await prisma.typePermission.update({ where: { id }, data: parsed.data }) : await prisma.typePermission.create({ data: parsed.data });
    await prisma.historiqueEntry.create({
      data: {
        entity: "TypePermission",
        entityId: type.id,
        action: id ? "modification_type" : "creation_type",
        detail: `Type « ${type.label} » : ${type.dureeMaxHeures} h au plus, ${type.plafondMensuel} par mois.`,
        userId: session.user.id,
      },
    });
  } catch {
    return { status: "error", message: "Ce libellé existe déjà." };
  }
  revalidatePath("/permissions-absence/parametrage");
  publishDataChanged();
  return { status: "success", message: id ? "Type modifié." : "Type créé." };
}

export async function creerTypePermissionAction(input: z.infer<typeof typeSchema>): Promise<ActionState> {
  return ecrireType(null, input);
}

export async function modifierTypePermissionAction(id: string, input: z.infer<typeof typeSchema>): Promise<ActionState> {
  return ecrireType(String(id), input);
}

export async function toggleTypePermissionAction(id: string): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Non authentifié." };
  if (!hasPermission(session, "absences.parametrer")) return { status: "error", message: "Action non autorisée." };
  const type = await prisma.typePermission.findUnique({ where: { id: String(id) } });
  if (!type) return { status: "error", message: "Type introuvable." };
  await prisma.typePermission.update({ where: { id: type.id }, data: { isActive: !type.isActive } });
  await prisma.historiqueEntry.create({
    data: {
      entity: "TypePermission",
      entityId: type.id,
      action: type.isActive ? "desactivation_type" : "activation_type",
      detail: `Type « ${type.label} » ${type.isActive ? "désactivé" : "activé"}.`,
      userId: session.user.id,
    },
  });
  revalidatePath("/permissions-absence/parametrage");
  publishDataChanged();
  return { status: "success", message: type.isActive ? "Type désactivé." : "Type activé." };
}

// ---------------------------------------------------------------------------------------------------------------------
// Aperçu (lecture seule) pour le formulaire : durée, maximum, plafond du mois — AUCUN second calcul côté écran
// ---------------------------------------------------------------------------------------------------------------------

export interface ApercuPermission {
  dureeMinutes: number;
  dureeMaxHeures: number;
  depasseMax: boolean;
  alerteCongeRecommande: boolean;
  /** Permissions de ce type déjà demandées ou accordées ce mois-ci, plafond du type, et reste. */
  utilise: number;
  plafond: number;
  restant: number;
  auDelaDuPlafond: boolean;
}

export async function apercuPermissionAction(input: {
  typePermissionId: string;
  date: string;
  heureDepart: string;
  heureRetourPrevue: string;
}): Promise<ActionState<ApercuPermission>> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Non authentifié." };
  if (!hasPermission(session, "absences.soumettre")) return { status: "error", message: "Action non autorisée." };

  const saisie = controlerSaisiePermission({
    date: String(input.date),
    heureDepart: String(input.heureDepart),
    heureRetourPrevue: String(input.heureRetourPrevue),
    motif: "motif de l'aperçu",
    aujourdhui: formatJourCivil(new Date()),
  });
  if (!saisie.ok) return { status: "error", message: saisie.erreur, fieldErrors: { [saisie.champ]: saisie.erreur } };
  const type = await prisma.typePermission.findUnique({ where: { id: String(input.typePermissionId) } });
  if (!type) return { status: "error", message: "Type de permission introuvable." };
  const mois = bornesMois(input.date);
  if (!mois) return { status: "error", message: "Date invalide." };

  const utilise = await prisma.demandePermission.count({
    where: {
      userId: session.user.id,
      typePermissionId: type.id,
      date: { gte: colonneDateDepuisJourCivil(mois.debut), lte: colonneDateDepuisJourCivil(mois.fin) },
      statut: { in: ["EN_ATTENTE_RESPONSABLE", "EN_ATTENTE_RH", "APPROUVEE", "CONSOMMEE"] },
    },
  });
  const duree = verifierDureeAutorisee(saisie.dureeMinutes, type.dureeMaxHeures);
  const plafond = evaluerPlafond({ utilise, plafond: type.plafondMensuel });
  return {
    status: "success",
    data: {
      dureeMinutes: saisie.dureeMinutes,
      dureeMaxHeures: type.dureeMaxHeures,
      depasseMax: duree.depasseMax,
      alerteCongeRecommande: duree.alerteCongeRecommande,
      utilise,
      plafond: type.plafondMensuel,
      restant: plafond.restant,
      auDelaDuPlafond: plafond.atteint,
    },
  };
}

"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  accorderCongeOffice,
  ajusterSolde,
  decrireModificationType,
  MESSAGE_NB_JOURS_SOLDES_FUTURS,
  ajouterJours,
  calculerNbJours,
  dateFinPourJours,
  deciderConge,
  exerciceDuDebit,
  fieldErrorsFromZod,
  formatJourCivil,
  initialiserSoldesExercice,
  jourCivilDepuisColonneDate,
  listerJours,
  lireJoursFeries,
  MAX_JOURS_PERIODE,
  MESSAGE_DATE_EMBAUCHE_MANQUANTE,
  modifierDateEmbauche,
  prisma,
  resoumettreConge,
  soumettreConge,
  transactionAbsence,
  verifierAnciennete,
  type ActionState,
  type ActionCircuitAbsence,
  type DemandeCongeEntree,
} from "backend";
import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { notify } from "@/lib/notifications";
import { notifierDecisionConge, notifierSoumissionConge } from "@/lib/conges/notifier";
import { piecesExistent } from "@/lib/conges/pieces";

const JOUR = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (AAAA-MM-JJ)");

const demandeSchema = z.object({
  typeCongeId: z.string().min(1, "Veuillez sélectionner un type de congé"),
  dateDebut: JOUR,
  dateFin: JOUR,
  motif: z.string().min(5, "Le motif doit comporter au moins 5 caractères").max(500, "Le motif ne doit pas dépasser 500 caractères"),
  interimaire: z.string().max(120).optional(),
  // Les noms sont contrôlés plus finement (forme, existence) par le moteur et `piecesExistent` : jamais une valeur libre.
  piecesJointes: z.array(z.object({ url: z.string().max(100), nomFichier: z.string().max(200).optional() })).max(10).optional(),
});

export type DemandeCongeInput = z.infer<typeof demandeSchema>;

const MESSAGE_PIECE_ABSENTE = "Une pièce jointe n'a pas été trouvée sur le serveur : déposez-la de nouveau.";

function revalider(demandeId?: string) {
  revalidatePath("/conges");
  revalidatePath("/conges/a-decider");
  revalidatePath("/conges/soldes");
  if (demandeId) revalidatePath(`/conges/${demandeId}`);
  publishDataChanged();
}

function versEntree(d: DemandeCongeInput): DemandeCongeEntree {
  return { ...d, interimaire: d.interimaire ?? null };
}

function frDate(jour: string): string {
  return jour.split("-").reverse().join("/");
}

// ---------------------------------------------------------------------------------------------------------------------
// Demandeur
// ---------------------------------------------------------------------------------------------------------------------

export async function soumettreCongeAction(input: DemandeCongeInput): Promise<ActionState<{ id: string; reference: string }>> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Non authentifié." };
  if (!hasPermission(session, "conges.soumettre")) return { status: "error", message: "Action non autorisée." };

  const parsed = demandeSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Formulaire invalide.", fieldErrors: fieldErrorsFromZod(parsed.error) };
  if (!(await piecesExistent(parsed.data.piecesJointes))) return { status: "error", message: MESSAGE_PIECE_ABSENTE };

  const r = await transactionAbsence((tx) =>
    soumettreConge(tx, { userId: session.user.id, entree: versEntree(parsed.data), maintenant: new Date() })
  );
  if (!r.ok) return { status: "error", message: r.erreur, fieldErrors: r.champ ? { [r.champ]: r.erreur } : undefined };

  await notifierSoumissionConge({
    soumission: r.valeur,
    demandeurNom: session.user.fullName,
    dateDebut: parsed.data.dateDebut,
    dateFin: parsed.data.dateFin,
    auteurId: session.user.id,
  });
  revalider(r.valeur.id);
  return {
    status: "success",
    message: r.valeur.statut === "EN_ATTENTE_RESPONSABLE" ? "Votre demande a été transmise à votre responsable." : "Votre demande a été transmise à la RH.",
    data: { id: r.valeur.id, reference: r.valeur.reference },
  };
}

export async function resoumettreCongeAction(demandeId: string, input: DemandeCongeInput): Promise<ActionState<{ id: string }>> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Non authentifié." };
  if (!hasPermission(session, "conges.soumettre")) return { status: "error", message: "Action non autorisée." };

  const parsed = demandeSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Formulaire invalide.", fieldErrors: fieldErrorsFromZod(parsed.error) };
  if (!(await piecesExistent(parsed.data.piecesJointes))) return { status: "error", message: MESSAGE_PIECE_ABSENTE };

  const r = await transactionAbsence((tx) =>
    resoumettreConge(tx, { demandeId: String(demandeId), acteurId: session.user.id, entree: versEntree(parsed.data), maintenant: new Date() })
  );
  if (!r.ok) return { status: "error", message: r.erreur, fieldErrors: r.champ ? { [r.champ]: r.erreur } : undefined };

  await notifierSoumissionConge({
    soumission: r.valeur,
    demandeurNom: session.user.fullName,
    dateDebut: parsed.data.dateDebut,
    dateFin: parsed.data.dateFin,
    auteurId: session.user.id,
  });
  revalider(r.valeur.id);
  return { status: "success", message: "Votre demande modifiée a été renvoyée.", data: { id: r.valeur.id } };
}

// ---------------------------------------------------------------------------------------------------------------------
// Décision (responsable, RH, DG selon l'étape : le moteur décide qui, jamais cette action)
// ---------------------------------------------------------------------------------------------------------------------

async function decider(
  demandeId: string,
  action: Exclude<ActionCircuitAbsence, { type: "RESOUMETTRE" }>,
  message: string
): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Non authentifié." };

  const r = await transactionAbsence((tx) =>
    deciderConge(tx, {
      demandeId: String(demandeId),
      // Permissions du RÔLE, jamais les délégations : décider ne se délègue pas.
      acteur: { id: session.user.id, rolePermissions: session.rolePermissions },
      action,
      peutAnnulerApresDebut: hasPermission(session, "conges.annuler"),
      maintenant: new Date(),
    })
  );
  if (!r.ok) return { status: "error", message: r.erreur, fieldErrors: r.champ ? { [r.champ]: r.erreur } : undefined };

  await notifierDecisionConge({ decision: r.valeur, acteurId: session.user.id, acteurNom: session.user.fullName });
  revalider(r.valeur.id);
  return { status: "success", message };
}

export async function approuverCongeAction(demandeId: string): Promise<ActionState> {
  return decider(demandeId, { type: "APPROUVER" }, "Décision enregistrée : demande approuvée.");
}

export async function rejeterCongeAction(demandeId: string, motif: string): Promise<ActionState> {
  return decider(demandeId, { type: "REJETER", motif: String(motif ?? "") }, "Demande rejetée.");
}

export async function demanderModificationCongeAction(demandeId: string, motif: string): Promise<ActionState> {
  return decider(demandeId, { type: "DEMANDER_MODIFICATION", motif: String(motif ?? "") }, "Modification demandée au collaborateur.");
}

export async function annulerCongeAction(demandeId: string, motif: string): Promise<ActionState> {
  return decider(demandeId, { type: "ANNULER", motif: String(motif ?? "") }, "Demande annulée.");
}

// ---------------------------------------------------------------------------------------------------------------------
// RH : congé d'office, soldes, dates d'embauche
// ---------------------------------------------------------------------------------------------------------------------

const officeSchema = demandeSchema.extend({ userId: z.string().min(1, "Collaborateur requis") });

export async function accorderCongeOfficeAction(input: z.infer<typeof officeSchema>): Promise<ActionState<{ id: string; reference: string }>> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Non authentifié." };
  // L'accord d'office est une décision RH : lue sur le rôle.
  if (!session.rolePermissions.includes("conges.valider_rh")) return { status: "error", message: "Action non autorisée." };

  const parsed = officeSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Formulaire invalide.", fieldErrors: fieldErrorsFromZod(parsed.error) };
  if (!(await piecesExistent(parsed.data.piecesJointes))) return { status: "error", message: MESSAGE_PIECE_ABSENTE };

  const { userId, ...entree } = parsed.data;
  const r = await transactionAbsence((tx) =>
    accorderCongeOffice(tx, { acteurId: session.user.id, userId, entree: versEntree(entree), maintenant: new Date() })
  );
  if (!r.ok) return { status: "error", message: r.erreur, fieldErrors: r.champ ? { [r.champ]: r.erreur } : undefined };

  await notify({
    userId,
    titre: "Congé accordé par la RH",
    message: `La RH vous a accordé un congé (${r.valeur.libelleType}, ${r.valeur.nbJours} jour(s)) du ${frDate(entree.dateDebut)} au ${frDate(entree.dateFin)}. Référence ${r.valeur.reference}.`,
    lien: `/conges/${r.valeur.id}`,
    priority: "IMPORTANT",
    category: "RH",
  });
  revalider(r.valeur.id);
  return { status: "success", message: "Congé accordé d'office.", data: { id: r.valeur.id, reference: r.valeur.reference } };
}

const ajustementSchema = z.object({
  soldeCongeId: z.string().min(1),
  montant: z.number().int("Le montant doit être un entier.").refine((v) => v !== 0, "Le montant ne peut pas être nul."),
  motif: z.string().min(5, "Le motif doit comporter au moins 5 caractères"),
});

export async function ajusterSoldeAction(input: z.infer<typeof ajustementSchema>): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Non authentifié." };
  if (!hasPermission(session, "conges.gerer_soldes")) return { status: "error", message: "Action non autorisée." };
  const parsed = ajustementSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Formulaire invalide.", fieldErrors: fieldErrorsFromZod(parsed.error) };

  const r = await transactionAbsence((tx) => ajusterSolde(tx, { ...parsed.data, acteurId: session.user.id }));
  if (!r.ok) return { status: "error", message: r.erreur, fieldErrors: r.champ ? { [r.champ]: r.erreur } : undefined };
  revalider();
  return { status: "success", message: `Solde ajusté : ${r.valeur.soldeRestant} jour(s) restant(s).` };
}

export async function initialiserSoldesAction(): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Non authentifié." };
  if (!hasPermission(session, "conges.gerer_soldes")) return { status: "error", message: "Action non autorisée." };
  const r = await transactionAbsence((tx) => initialiserSoldesExercice(tx, { reference: formatJourCivil(new Date()), acteurId: session.user.id }));
  if (!r.ok) return { status: "error", message: r.erreur };
  revalider();
  return { status: "success", message: `${r.valeur.soldesCrees} solde(s) créé(s) pour ${r.valeur.utilisateurs} compte(s).` };
}

export async function modifierDateEmbaucheAction(userId: string, date: string | null): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Non authentifié." };
  if (!hasPermission(session, "conges.gerer_soldes")) return { status: "error", message: "Action non autorisée." };
  const jour = date === null || date === "" ? null : JOUR.safeParse(date).success ? date : undefined;
  if (jour === undefined) return { status: "error", message: "Date d'embauche invalide.", fieldErrors: { date: "Format de date invalide." } };
  const r = await transactionAbsence((tx) => modifierDateEmbauche(tx, { userId: String(userId), date: jour, acteurId: session.user.id }));
  if (!r.ok) return { status: "error", message: r.erreur, fieldErrors: r.champ ? { [r.champ]: r.erreur } : undefined };
  revalider();
  return { status: "success", message: "Date d'embauche enregistrée." };
}

// ---------------------------------------------------------------------------------------------------------------------
// Types de congé
// ---------------------------------------------------------------------------------------------------------------------

const typeSchema = z.object({
  code: z.string().trim().min(2, "Le code doit comporter au moins 2 caractères").max(40).toUpperCase(),
  label: z.string().trim().min(3, "Le libellé doit comporter au moins 3 caractères").max(120),
  categorie: z.enum(["CONGE_STANDARD", "PERMISSION_EXCEPTIONNELLE"]),
  nbJoursDefaut: z.number().int().min(0).max(366),
  decompteType: z.enum(["CALENDAIRE", "OUVRABLE"]),
  justificatifObligatoire: z.boolean(),
  nonDeductibleSolde: z.boolean(),
  ancienneteMinimumMois: z.number().int().min(0).max(120),
});

async function ecrireType(id: string | null, input: z.infer<typeof typeSchema>): Promise<ActionState> {
  let nbJoursModifie = false;
  const session = await getSession();
  if (!session) return { status: "error", message: "Non authentifié." };
  if (!hasPermission(session, "conges.parametrer_types")) return { status: "error", message: "Action non autorisée." };
  const parsed = typeSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Formulaire invalide.", fieldErrors: fieldErrorsFromZod(parsed.error) };

  try {
    // Ancienne valeur lue avant l'écriture : l'historique garde l'ancienne ET la nouvelle (C1).
    const avant = id ? await prisma.typeConge.findUnique({ where: { id } }) : null;
    if (id && !avant) return { status: "error", message: "Type introuvable." };
    const type = id ? await prisma.typeConge.update({ where: { id }, data: parsed.data }) : await prisma.typeConge.create({ data: parsed.data });
    await prisma.historiqueEntry.create({
      data: {
        entity: "TypeConge",
        entityId: type.id,
        action: id ? "modification_type" : "creation_type",
        detail: avant
          ? decrireModificationType(avant, type)
          : `Type « ${type.label} » (${type.code}) créé : ${type.nbJoursDefaut} jour(s), ${type.decompteType}, ${type.nonDeductibleSolde ? "non déductible" : "déductible"}.`,
        userId: session.user.id,
      },
    });
    nbJoursModifie = Boolean(avant && avant.nbJoursDefaut !== type.nbJoursDefaut);
  } catch {
    return { status: "error", message: "Ce code ou ce libellé existe déjà." };
  }
  revalidatePath("/conges/parametrage");
  publishDataChanged();
  return { status: "success", message: id ? (nbJoursModifie ? `Type modifié. ${MESSAGE_NB_JOURS_SOLDES_FUTURS}` : "Type modifié.") : "Type créé." };
}

export async function creerTypeCongeAction(input: z.infer<typeof typeSchema>): Promise<ActionState> {
  return ecrireType(null, input);
}

export async function modifierTypeCongeAction(id: string, input: z.infer<typeof typeSchema>): Promise<ActionState> {
  return ecrireType(String(id), input);
}

export async function toggleTypeCongeAction(id: string): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Non authentifié." };
  if (!hasPermission(session, "conges.parametrer_types")) return { status: "error", message: "Action non autorisée." };
  const type = await prisma.typeConge.findUnique({ where: { id: String(id) } });
  if (!type) return { status: "error", message: "Type introuvable." };
  await prisma.typeConge.update({ where: { id: type.id }, data: { isActive: !type.isActive } });
  await prisma.historiqueEntry.create({
    data: {
      entity: "TypeConge",
      entityId: type.id,
      action: type.isActive ? "desactivation_type" : "activation_type",
      detail: `Type « ${type.label} » ${type.isActive ? "désactivé" : "activé"}.`,
      userId: session.user.id,
    },
  });
  revalidatePath("/conges/parametrage");
  publishDataChanged();
  return { status: "success", message: type.isActive ? "Type désactivé." : "Type activé." };
}

// ---------------------------------------------------------------------------------------------------------------------
// Aperçu (lecture seule) : jours décomptés, solde et ancienneté pour le formulaire — AUCUN second calcul côté écran
// ---------------------------------------------------------------------------------------------------------------------

export interface ApercuConge {
  /** Date de fin retenue : calculée pour un type à durée fixée (permission exceptionnelle), sinon celle saisie. */
  dateFin: string;
  nbJours: number;
  joursCalendaires: number;
  joursFeriesInclus: number;
  deductible: boolean;
  /** Solde de l'exercice concerné (`null` : non déductible, date d'embauche absente ou période sur deux exercices). */
  soldeRestant: number | null;
  exercice: number | null;
  avertissement: string | null;
}

export async function apercuCongeAction(input: { typeCongeId: string; dateDebut: string; dateFin: string; userId?: string }): Promise<ActionState<ApercuConge>> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Non authentifié." };
  const peutPourAutrui = session.rolePermissions.includes("conges.valider_rh");
  if (!hasPermission(session, "conges.soumettre") && !peutPourAutrui) return { status: "error", message: "Action non autorisée." };
  // Pour un congé d'office, l'aperçu porte sur le collaborateur choisi (RH seulement) ; sinon sur soi-même.
  const userId = input.userId && peutPourAutrui ? String(input.userId) : session.user.id;

  const debut = JOUR.safeParse(input.dateDebut);
  const fin = JOUR.safeParse(input.dateFin);
  if (!debut.success || !fin.success) return { status: "error", message: "Période invalide." };
  const type = await prisma.typeConge.findUnique({ where: { id: String(input.typeCongeId) } });
  if (!type) return { status: "error", message: "Type de congé introuvable." };

  // Même règle que la soumission (`preparerConge`) : la durée d'une permission exceptionnelle est fixée par le type.
  const feriesLarges = await lireJoursFeries(prisma, input.dateDebut, ajouterJours(input.dateDebut, MAX_JOURS_PERIODE * 2));
  const dateFin =
    type.categorie === "PERMISSION_EXCEPTIONNELLE"
      ? dateFinPourJours({ debut: input.dateDebut, nbJours: type.nbJoursDefaut, decompte: type.decompteType, joursFeries: feriesLarges })
      : input.dateFin;
  if (dateFin < input.dateDebut) return { status: "error", message: "Période invalide." };
  if (listerJours(input.dateDebut, dateFin).length > MAX_JOURS_PERIODE) return { status: "error", message: "Période trop longue." };

  const d = calculerNbJours({ debut: input.dateDebut, fin: dateFin, decompte: type.decompteType, joursFeries: feriesLarges });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { dateEmbauche: true } });
  const dateEmbauche = user?.dateEmbauche ? jourCivilDepuisColonneDate(user.dateEmbauche) : null;

  const deductible = !type.nonDeductibleSolde && type.nbJoursDefaut > 0;
  let soldeRestant: number | null = null;
  let exercice: number | null = null;
  let avertissement: string | null = null;

  const anc = verifierAnciennete({ dateEmbauche, moisRequis: type.ancienneteMinimumMois, reference: input.dateDebut });
  if (!anc.eligible) avertissement = anc.erreur;

  if (deductible) {
    if (!dateEmbauche) {
      avertissement = avertissement ?? MESSAGE_DATE_EMBAUCHE_MANQUANTE;
    } else if (d.joursDecomptes.length > 0) {
      const ex = exerciceDuDebit(d.joursDecomptes, dateEmbauche);
      if (!ex.ok) {
        avertissement = avertissement ?? ex.erreur;
      } else {
        exercice = ex.exercice.exercice;
        const solde = await prisma.soldeConge.findUnique({
          where: { userId_typeCongeId_exercice: { userId, typeCongeId: type.id, exercice } },
        });
        // Pas encore de ligne : la dotation complète du type sera créée à la validation.
        soldeRestant = solde ? solde.soldeRestant : type.nbJoursDefaut;
        if (soldeRestant < d.nbJours) avertissement = avertissement ?? `Solde insuffisant : ${soldeRestant} jour(s) restant(s) pour ${d.nbJours} demandé(s).`;
      }
    }
  }

  return {
    status: "success",
    data: {
      dateFin,
      nbJours: d.nbJours,
      joursCalendaires: d.joursCalendaires,
      joursFeriesInclus: d.joursFeriesInclus.length,
      deductible,
      soldeRestant,
      exercice,
      avertissement,
    },
  };
}

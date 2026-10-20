"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  apercuConge,
  deciderConge,
  fieldErrorsFromZod,
  PERMISSION_ETAPE_RH_CONGE,
  resoumettreConge,
  saisirCongeRH,
  soumettreConge,
  transactionConge,
  type ActionDecisionConge,
  type ActionState,
} from "backend";
import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import {
  notifierDecisionConge,
  notifierSaisieRHConge,
  notifierSoumissionConge,
} from "@/lib/conges/notifier";

const jourSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (AAAA-MM-JJ).");

const entreeSchema = z.object({
  nature: z.enum(["CONGE", "PERMISSION_EXCEPTIONNELLE"]),
  motif: z.string().trim().min(3, "Le motif doit comporter au moins 3 caractères.").max(500, "Le motif ne doit pas dépasser 500 caractères."),
  dateDebut: jourSchema,
  dateFin: jourSchema,
});

const identifiantSchema = z.string().min(1, "Identifiant invalide.");
const motifSchema = z.string().trim().min(3, "Le motif doit comporter au moins 3 caractères.").max(500);
const observationSchema = z.string().trim().max(500, "L'observation ne doit pas dépasser 500 caractères.").optional();

type EntreeCongeInput = z.infer<typeof entreeSchema>;
type SessionPortail = NonNullable<Awaited<ReturnType<typeof getSession>>>;

function revalider(demandeId?: string) {
  revalidatePath("/conges");
  revalidatePath("/conges/a-decider");
  revalidatePath("/conges/toutes");
  if (demandeId) revalidatePath(`/conges/${demandeId}`);
  publishDataChanged();
}

function erreurTransaction<T>(resultat: { ok: false; erreur: string; champ?: string }): ActionState<T> {
  return {
    status: "error",
    message: resultat.erreur,
    fieldErrors: resultat.champ ? { [resultat.champ]: resultat.erreur } : undefined,
  };
}

function erreurValidation<T>(error: z.ZodError): ActionState<T> {
  return {
    status: "error",
    message: "Formulaire invalide.",
    fieldErrors: fieldErrorsFromZod(error),
  };
}

async function sessionSoumission(): Promise<
  | { ok: true; session: NonNullable<Awaited<ReturnType<typeof getSession>>> }
  | { ok: false; state: ActionState }
> {
  const session = await getSession();
  if (!session) return { ok: false, state: { status: "error", message: "Non authentifié." } };
  if (!hasPermission(session, "conges.soumettre")) {
    return { ok: false, state: { status: "error", message: "Action non autorisée." } };
  }
  return { ok: true, session };
}

async function sessionDecision(): Promise<
  | { ok: true; session: SessionPortail }
  | { ok: false; state: ActionState }
> {
  const session = await getSession();
  if (!session) return { ok: false, state: { status: "error", message: "Non authentifié." } };
  return { ok: true, session };
}

export async function soumettreCongeAction(
  input: EntreeCongeInput
): Promise<ActionState<{ id: string; reference: string }>> {
  const acces = await sessionSoumission();
  if (!acces.ok) return acces.state;

  const parsed = entreeSchema.safeParse(input);
  if (!parsed.success) return erreurValidation(parsed.error);

  const maintenant = new Date();
  const resultat = await transactionConge((tx) =>
    soumettreConge(tx, { userId: acces.session.user.id, entree: parsed.data, maintenant })
  );
  if (!resultat.ok) return erreurTransaction(resultat);

  await notifierSoumissionConge({
    soumission: resultat.valeur,
    demandeurNom: acces.session.user.fullName,
    nature: parsed.data.nature,
    dateDebut: parsed.data.dateDebut,
    dateFin: parsed.data.dateFin,
    auteurId: acces.session.user.id,
  });
  revalider(resultat.valeur.id);
  return {
    status: "success",
    message: "Votre demande a été transmise pour décision.",
    data: { id: resultat.valeur.id, reference: resultat.valeur.reference },
  };
}

export async function resoumettreCongeAction(
  demandeId: string,
  input: EntreeCongeInput
): Promise<ActionState<{ id: string; reference: string }>> {
  const acces = await sessionSoumission();
  if (!acces.ok) return acces.state;

  const id = identifiantSchema.safeParse(demandeId);
  const entree = entreeSchema.safeParse(input);
  if (!id.success) return erreurValidation(id.error);
  if (!entree.success) return erreurValidation(entree.error);

  const maintenant = new Date();
  const resultat = await transactionConge((tx) =>
    resoumettreConge(tx, {
      demandeId: id.data,
      acteurId: acces.session.user.id,
      entree: entree.data,
      maintenant,
    })
  );
  if (!resultat.ok) return erreurTransaction(resultat);

  await notifierSoumissionConge({
    soumission: resultat.valeur,
    demandeurNom: acces.session.user.fullName,
    nature: entree.data.nature,
    dateDebut: entree.data.dateDebut,
    dateFin: entree.data.dateFin,
    auteurId: acces.session.user.id,
  });
  revalider(resultat.valeur.id);
  return {
    status: "success",
    message: "Votre demande modifiée a été renvoyée.",
    data: { id: resultat.valeur.id, reference: resultat.valeur.reference },
  };
}

async function decider(
  session: SessionPortail,
  demandeId: string,
  action: ActionDecisionConge,
  message: string
): Promise<ActionState> {
  const id = identifiantSchema.safeParse(demandeId);
  if (!id.success) return erreurValidation(id.error);

  const resultat = await transactionConge((tx) =>
    deciderConge(tx, {
      demandeId: id.data,
      acteur: { id: session.user.id, rolePermissions: session.rolePermissions },
      action,
      peutAnnulerApresDebut: session.rolePermissions.includes("conges.annuler"),
      maintenant: new Date(),
    })
  );
  if (!resultat.ok) return erreurTransaction(resultat);

  await notifierDecisionConge({
    decision: resultat.valeur,
    acteurId: session.user.id,
    acteurNom: session.user.fullName,
  });
  revalider(resultat.valeur.id);
  return { status: "success", message };
}

export async function approuverCongeAction(demandeId: string, observationRH?: string): Promise<ActionState> {
  const acces = await sessionDecision();
  if (!acces.ok) return acces.state;
  const observation = observationSchema.safeParse(observationRH);
  if (!observation.success) return erreurValidation(observation.error);
  return decider(
    acces.session,
    demandeId,
    { type: "APPROUVER", observationRH: observation.data },
    "Demande approuvée."
  );
}

export async function rejeterCongeAction(
  demandeId: string,
  motif: string,
  compterJoursPassesAbsents = false,
  observationRH?: string
): Promise<ActionState> {
  const acces = await sessionDecision();
  if (!acces.ok) return acces.state;
  const parsedMotif = motifSchema.safeParse(motif);
  const observation = observationSchema.safeParse(observationRH);
  if (!parsedMotif.success) return erreurValidation(parsedMotif.error);
  if (!observation.success) return erreurValidation(observation.error);
  if (typeof compterJoursPassesAbsents !== "boolean") {
    return { status: "error", message: "Valeur invalide pour le traitement des jours passés." };
  }
  return decider(
    acces.session,
    demandeId,
    {
      type: "REJETER",
      motif: parsedMotif.data,
      compterJoursPassesAbsents,
      observationRH: observation.data,
    },
    "Demande rejetée."
  );
}

export async function demanderModificationCongeAction(
  demandeId: string,
  motif: string,
  observationRH?: string
): Promise<ActionState> {
  const acces = await sessionDecision();
  if (!acces.ok) return acces.state;
  const parsedMotif = motifSchema.safeParse(motif);
  const observation = observationSchema.safeParse(observationRH);
  if (!parsedMotif.success) return erreurValidation(parsedMotif.error);
  if (!observation.success) return erreurValidation(observation.error);
  return decider(
    acces.session,
    demandeId,
    { type: "DEMANDER_MODIFICATION", motif: parsedMotif.data, observationRH: observation.data },
    "Modification demandée au collaborateur."
  );
}

export async function annulerCongeAction(demandeId: string, motif: string): Promise<ActionState> {
  const acces = await sessionDecision();
  if (!acces.ok) return acces.state;
  const parsedMotif = motifSchema.safeParse(motif);
  if (!parsedMotif.success) return erreurValidation(parsedMotif.error);
  return decider(
    acces.session,
    demandeId,
    { type: "ANNULER", motif: parsedMotif.data },
    "Demande annulée."
  );
}

export async function saisirCongeRHAction(
  userId: string,
  input: EntreeCongeInput
): Promise<ActionState<{ id: string; reference: string }>> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Non authentifié." };
  if (!session.rolePermissions.includes(PERMISSION_ETAPE_RH_CONGE)) {
    return { status: "error", message: "Action non autorisée." };
  }

  const id = identifiantSchema.safeParse(userId);
  const entree = entreeSchema.safeParse(input);
  if (!id.success) return erreurValidation(id.error);
  if (!entree.success) return erreurValidation(entree.error);

  const resultat = await transactionConge((tx) =>
    saisirCongeRH(tx, {
      acteurId: session.user.id,
      userId: id.data,
      entree: entree.data,
      maintenant: new Date(),
    })
  );
  if (!resultat.ok) return erreurTransaction(resultat);

  await notifierSaisieRHConge({
    demandeId: resultat.valeur.id,
    reference: resultat.valeur.reference,
    nature: entree.data.nature,
    dateDebut: entree.data.dateDebut,
    dateFin: entree.data.dateFin,
    salarieId: id.data,
    auteurId: session.user.id,
  });

  revalider(resultat.valeur.id);
  return {
    status: "success",
    message: "Congé enregistré et validé.",
    data: { id: resultat.valeur.id, reference: resultat.valeur.reference },
  };
}

export async function apercuCongeAction(
  input: EntreeCongeInput,
  exclureDemandeId?: string
): Promise<ActionState<{ nbJoursOuvres: number; joursFeriesInclus: string[] }>> {
  const acces = await sessionSoumission();
  if (!acces.ok) return acces.state;

  const entree = entreeSchema.safeParse(input);
  const exclusion = exclureDemandeId === undefined ? undefined : identifiantSchema.safeParse(exclureDemandeId);
  if (!entree.success) return erreurValidation(entree.error);
  if (exclusion && !exclusion.success) return erreurValidation(exclusion.error);

  const maintenant = new Date();
  const resultat = await transactionConge((tx) =>
    apercuConge(tx, {
      userId: acces.session.user.id,
      entree: entree.data,
      maintenant,
      ...(exclusion?.success ? { exclureDemandeId: exclusion.data } : {}),
    })
  );
  if (!resultat.ok) return erreurTransaction(resultat);
  return {
    status: "success",
    message: "Aperçu calculé.",
    data: {
      nbJoursOuvres: resultat.valeur.nbJoursOuvres,
      joursFeriesInclus: resultat.valeur.joursFeriesInclus,
    },
  };
}

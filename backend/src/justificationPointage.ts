// Pointage V2, lot 4 (2026-10-08) : justification d'un retard ou d'un départ anticipé, et décision.
//
// Logique PURE (aucun accès base, aucun envoi) : qui décide, quelles transitions sont permises, qui a le droit d'agir,
// et le texte des notifications. L'application en base (écritures conditionnelles, historique) et les envois restent
// dans le frontend. Le décideur est TOUJOURS recalculé à partir du responsable ACTUEL du service du collaborateur
// (même principe que l'étape Service du circuit des demandes), jamais à partir d'un nom de rôle.

import type { StatutJustificationPointage } from "./generated/prisma/enums";
import { PERMISSION_RH_POINTAGE } from "./pointage-utils";
import type { ServiceDuDemandeur } from "./services";

/** Longueurs du motif saisi par le collaborateur (après nettoyage) et du motif de refus. */
export const MOTIF_JUSTIFICATION_MIN = 3;
export const MOTIF_JUSTIFICATION_MAX = 500;
export const MOTIF_REFUS_JUSTIFICATION_MIN = 3;

/** Service du collaborateur tel que lu au moment de l'action (`null` : aucun service). */
export interface ServiceCollaborateur {
  name: string;
  responsableId: string | null;
  responsableActif: boolean;
}

/** Pourquoi la RH décide à la place d'un responsable de service. */
export type RaisonDecideurRH = "SANS_SERVICE" | "SANS_RESPONSABLE" | "RESPONSABLE_INACTIF" | "EST_RESPONSABLE";

export type DecideurJustification =
  | { type: "RESPONSABLE"; responsableId: string }
  | { type: "RH"; raison: RaisonDecideurRH };

/** Adapte le résultat de `chargerServiceDuDemandeur` (services.ts) au format attendu ici. */
export function serviceCollaborateurDepuis(s: ServiceDuDemandeur): ServiceCollaborateur | null {
  if (s.serviceNom === null) return null;
  return { name: s.serviceNom, responsableId: s.responsableId, responsableActif: s.responsableActif };
}

/**
 * Décideur d'une justification : le responsable du service du collaborateur ; à défaut la RH (détenteurs de
 * `PERMISSION_RH_POINTAGE`). Le DG tombe dans `EST_RESPONSABLE` (responsable de « Direction DG ») ou `SANS_SERVICE`.
 */
export function resoudreDecideurJustification(params: {
  collaborateurId: string;
  service: ServiceCollaborateur | null;
}): DecideurJustification {
  const { collaborateurId, service } = params;
  if (!service) return { type: "RH", raison: "SANS_SERVICE" };
  if (!service.responsableId) return { type: "RH", raison: "SANS_RESPONSABLE" };
  if (service.responsableId === collaborateurId) return { type: "RH", raison: "EST_RESPONSABLE" };
  if (!service.responsableActif) return { type: "RH", raison: "RESPONSABLE_INACTIF" };
  return { type: "RESPONSABLE", responsableId: service.responsableId };
}

/** Compte qui tente de décider : son identifiant et ses permissions effectives (session). */
export interface ActeurJustification {
  id: string;
  permissions: readonly string[];
}

export const MESSAGE_PROPRE_JUSTIFICATION = "Vous ne pouvez pas décider de votre propre justification.";
export const MESSAGE_RESERVE_RESPONSABLE =
  "Seul le responsable du service du collaborateur peut décider de cette justification.";
export const MESSAGE_RESERVE_RH = "Cette justification est décidée par la RH.";

/**
 * Raison du refus si `acteur` ne peut pas décider de cette justification, `null` s'il le peut. Recalculée à chaque
 * action : un changement de responsable de service prend effet immédiatement.
 */
export function refusDecideur(
  decideur: DecideurJustification,
  acteur: ActeurJustification,
  collaborateurId: string
): string | null {
  // Le décideur n'est jamais le collaborateur, même s'il détient la permission RH.
  if (acteur.id === collaborateurId) return MESSAGE_PROPRE_JUSTIFICATION;
  if (decideur.type === "RESPONSABLE") {
    return acteur.id === decideur.responsableId ? null : MESSAGE_RESERVE_RESPONSABLE;
  }
  return acteur.permissions.includes(PERMISSION_RH_POINTAGE) ? null : MESSAGE_RESERVE_RH;
}

// ---------------------------------------------------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------------------------------------------------

export type ActionJustification =
  | { type: "SOUMETTRE"; motif: string }
  | { type: "ACCEPTER" }
  | { type: "REFUSER"; motifRefus: string };

export type ResultatTransitionJustification =
  | { ok: true; statut: StatutJustificationPointage; motif?: string; motifRefus?: string }
  | { ok: false; erreur: string };

/** Statuts depuis lesquels le collaborateur peut (encore) justifier. */
export const STATUTS_JUSTIFIABLES: readonly StatutJustificationPointage[] = ["EN_ATTENTE", "NON_JUSTIFIEE"];

export function peutSoumettreJustification(statut: StatutJustificationPointage): boolean {
  return STATUTS_JUSTIFIABLES.includes(statut);
}

/** Espaces de début et de fin retirés, suites d'espaces (sauts de ligne compris) réduites à un seul espace. */
export function nettoyerMotif(motif: string): string {
  return motif.replace(/\s+/g, " ").trim();
}

const MESSAGE_STATUT_FIGE: Record<StatutJustificationPointage, string> = {
  EN_ATTENTE: "Le collaborateur n'a pas encore envoyé de justification.",
  NON_JUSTIFIEE: "Le collaborateur n'a pas encore envoyé de justification.",
  SOUMISE: "La justification a déjà été envoyée et attend la décision.",
  ACCEPTEE: "La justification a déjà été acceptée.",
  REFUSEE: "La justification a déjà été refusée.",
};

/**
 * Transitions permises : soumission depuis EN_ATTENTE ou NON_JUSTIFIEE vers SOUMISE ; décision depuis SOUMISE vers
 * ACCEPTEE ou REFUSEE (motif de refus obligatoire). ACCEPTEE et REFUSEE sont définitives.
 */
export function transitionJustification(
  statut: StatutJustificationPointage,
  action: ActionJustification
): ResultatTransitionJustification {
  if (action.type === "SOUMETTRE") {
    if (!peutSoumettreJustification(statut)) return { ok: false, erreur: MESSAGE_STATUT_FIGE[statut] };
    const motif = nettoyerMotif(action.motif);
    if (motif.length < MOTIF_JUSTIFICATION_MIN) {
      return { ok: false, erreur: `Le motif doit contenir au moins ${MOTIF_JUSTIFICATION_MIN} caractères.` };
    }
    if (motif.length > MOTIF_JUSTIFICATION_MAX) {
      return { ok: false, erreur: `Le motif ne doit pas dépasser ${MOTIF_JUSTIFICATION_MAX} caractères.` };
    }
    return { ok: true, statut: "SOUMISE", motif };
  }

  if (statut !== "SOUMISE") return { ok: false, erreur: MESSAGE_STATUT_FIGE[statut] };
  if (action.type === "ACCEPTER") return { ok: true, statut: "ACCEPTEE" };

  const motifRefus = nettoyerMotif(action.motifRefus);
  if (motifRefus.length < MOTIF_REFUS_JUSTIFICATION_MIN) {
    return {
      ok: false,
      erreur: `Le motif du refus doit contenir au moins ${MOTIF_REFUS_JUSTIFICATION_MIN} caractères.`,
    };
  }
  if (motifRefus.length > MOTIF_JUSTIFICATION_MAX) {
    return { ok: false, erreur: `Le motif du refus ne doit pas dépasser ${MOTIF_JUSTIFICATION_MAX} caractères.` };
  }
  return { ok: true, statut: "REFUSEE", motifRefus };
}

// ---------------------------------------------------------------------------------------------------------------------
// Libellés et messages
// ---------------------------------------------------------------------------------------------------------------------

export const LIBELLE_STATUT_JUSTIFICATION: Record<StatutJustificationPointage, string> = {
  EN_ATTENTE: "Justification attendue",
  SOUMISE: "Justification envoyée",
  ACCEPTEE: "Justification acceptée",
  REFUSEE: "Justification refusée",
  NON_JUSTIFIEE: "Non justifié",
};

/** Actions d'historique (`HistoriqueEntry.entity = "JustificationPointage"`). */
export const ACTION_HISTORIQUE_JUSTIFICATION = {
  SOUMETTRE: "soumission_justification",
  ACCEPTER: "acceptation_justification",
  REFUSER: "refus_justification",
} as const;

/** Pointage concerné par une justification, tel qu'affiché dans les messages. */
export interface PointageJustifie {
  type: "ARRIVEE" | "DEPART";
  heure: Date;
  minutesRetard: number | null;
}

const deux = (n: number) => String(n).padStart(2, "0");

/** Date « JJ/MM/AAAA » en heure locale du serveur (Abidjan), comme le reste du module. */
export function dateCourte(d: Date): string {
  return `${deux(d.getDate())}/${deux(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Heure « HH:MM » en heure locale du serveur. */
export function heureCourte(d: Date): string {
  return `${deux(d.getHours())}:${deux(d.getMinutes())}`;
}

/** « retard de 25 min le 12/10/2026 (arrivée à 08:10) » ou « départ anticipé le 12/10/2026 à 15:00 ». */
export function descriptionAnomalie(p: PointageJustifie): string {
  if (p.type === "ARRIVEE") {
    return `retard de ${p.minutesRetard ?? 0} min le ${dateCourte(p.heure)} (arrivée à ${heureCourte(p.heure)})`;
  }
  return `départ anticipé le ${dateCourte(p.heure)} à ${heureCourte(p.heure)}`;
}

/**
 * Désignation du collaborateur dans un message destiné au décideur. Variante RH explicite sur la raison pour laquelle
 * la RH décide (ex. « X, responsable du service Commercial »).
 */
export function presentationCollaborateur(
  collaborateurNom: string,
  serviceNom: string | null,
  decideur: DecideurJustification
): string {
  if (decideur.type === "RESPONSABLE") return collaborateurNom;
  switch (decideur.raison) {
    case "EST_RESPONSABLE":
      return `${collaborateurNom}, responsable du service ${serviceNom ?? "?"},`;
    case "SANS_SERVICE":
      return `${collaborateurNom} (rattaché à aucun service)`;
    case "SANS_RESPONSABLE":
      return `${collaborateurNom} (service ${serviceNom ?? "?"}, sans responsable)`;
    case "RESPONSABLE_INACTIF":
      return `${collaborateurNom} (service ${serviceNom ?? "?"}, responsable désactivé)`;
  }
}

export interface MessageJustification {
  titre: string;
  message: string;
}

/** Au décideur, quand le collaborateur envoie sa justification. */
export function messageSoumissionJustification(params: {
  collaborateurNom: string;
  serviceNom: string | null;
  decideur: DecideurJustification;
  pointage: PointageJustifie;
  motif: string;
}): MessageJustification {
  const { collaborateurNom, serviceNom, decideur, pointage, motif } = params;
  const qui = presentationCollaborateur(collaborateurNom, serviceNom, decideur);
  const suite = decideur.type === "RH" ? " Décision attendue de la RH." : " Décision attendue de votre part.";
  return {
    titre: pointage.type === "ARRIVEE" ? "Justification de retard à examiner" : "Justification de départ à examiner",
    message: `${qui} a justifié son ${descriptionAnomalie(pointage)} : « ${motif} ».${suite}`,
  };
}

/** Au collaborateur, après la décision. */
export function messageDecisionJustification(params: {
  pointage: PointageJustifie;
  statut: "ACCEPTEE" | "REFUSEE";
  decideurNom: string;
  motifRefus?: string | null;
}): MessageJustification {
  const { pointage, statut, decideurNom, motifRefus } = params;
  const objet = `Votre justification du ${descriptionAnomalie(pointage)}`;
  if (statut === "ACCEPTEE") {
    return { titre: "Justification acceptée", message: `${objet} a été acceptée par ${decideurNom}.` };
  }
  return {
    titre: "Justification refusée",
    message: `${objet} a été refusée par ${decideurNom}. Motif : ${motifRefus ?? "—"}`,
  };
}

/** Qui examinera la justification, pour l'écran du collaborateur. */
export function libelleDecideur(decideur: DecideurJustification, responsableNom: string | null): string {
  if (decideur.type === "RESPONSABLE") return `votre responsable de service${responsableNom ? `, ${responsableNom}` : ""}`;
  return "la RH";
}

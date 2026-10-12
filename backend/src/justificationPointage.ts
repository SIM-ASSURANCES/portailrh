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

/** Pourquoi la RH (ou, à défaut, le DG) décide à la place d'un responsable de service. */
export type RaisonDecideurRH = "SANS_SERVICE" | "SANS_RESPONSABLE" | "RESPONSABLE_INACTIF" | "EST_RESPONSABLE";

/**
 * Permission qui désigne le DG, dernier recours de la décision (2026-10-12) : la même que l'étape DG du circuit des
 * demandes (`treso.decider_dg`), donnée au seul rôle DG (seed, migration `20261006120000` : rôles portant
 * `systeme.reinitialiser`) et jamais délégable (`PERMISSIONS_DECISION_NON_DELEGABLES`). Jamais un nom de rôle.
 */
export const PERMISSION_DG_JUSTIFICATION = "treso.decider_dg";

export type DecideurJustification =
  | { type: "RESPONSABLE"; responsableId: string }
  | { type: "RH"; raison: RaisonDecideurRH }
  /** Dernier recours : aucun compte RH actif autre que le collaborateur. */
  | { type: "DG"; raison: RaisonDecideurRH };

/** Adapte le résultat de `chargerServiceDuDemandeur` (services.ts) au format attendu ici. */
export function serviceCollaborateurDepuis(s: ServiceDuDemandeur): ServiceCollaborateur | null {
  if (s.serviceNom === null) return null;
  return { name: s.serviceNom, responsableId: s.responsableId, responsableActif: s.responsableActif };
}

/**
 * Décideur d'une justification, par priorité (2026-10-12) : (1) le responsable actif du service du collaborateur, s'il
 * n'est pas le collaborateur ; (2) sinon la RH, s'il existe un compte RH actif AUTRE que le collaborateur ; (3) sinon le
 * DG (`PERMISSION_DG_JUSTIFICATION`). `comptesRH` : comptes actifs dont le RÔLE porte `PERMISSION_RH_POINTAGE` (le
 * collaborateur peut y figurer, il est écarté ici). Personne ne décide sa propre justification (`refusDecideur`).
 */
export function resoudreDecideurJustification(params: {
  collaborateurId: string;
  service: ServiceCollaborateur | null;
  comptesRH: readonly string[];
}): DecideurJustification {
  const { collaborateurId, service, comptesRH } = params;
  let raison: RaisonDecideurRH;
  if (!service) raison = "SANS_SERVICE";
  else if (!service.responsableId) raison = "SANS_RESPONSABLE";
  else if (service.responsableId === collaborateurId) raison = "EST_RESPONSABLE";
  else if (!service.responsableActif) raison = "RESPONSABLE_INACTIF";
  else return { type: "RESPONSABLE", responsableId: service.responsableId };
  return comptesRH.some((id) => id !== collaborateurId) ? { type: "RH", raison } : { type: "DG", raison };
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
export const MESSAGE_RESERVE_DG = "Cette justification est décidée par le DG (aucun autre compte RH ne peut le faire).";

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
  if (decideur.type === "DG") {
    return acteur.permissions.includes(PERMISSION_DG_JUSTIFICATION) ? null : MESSAGE_RESERVE_DG;
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
  const suite =
    decideur.type === "RH"
      ? " Décision attendue de la RH."
      : decideur.type === "DG"
        ? " Aucun autre compte RH ne peut décider : décision attendue de votre part."
        : " Décision attendue de votre part.";
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

/**
 * Destinataires des notifications adressées au décideur (2026-10-12), mêmes règles que la décision : le responsable du
 * service ; sinon les comptes dont le rôle porte la permission RH ; sinon (dernier recours) ceux dont le rôle porte la
 * permission du DG. Jamais le collaborateur ; le DG n'est notifié que dans le cas de repli.
 */
export type DestinatairesDecideur =
  | { type: "COMPTE"; userId: string }
  | { type: "PERMISSION"; permission: string; exclureUserId: string };

export function destinatairesDecideur(decideur: DecideurJustification, collaborateurId: string): DestinatairesDecideur {
  if (decideur.type === "RESPONSABLE") return { type: "COMPTE", userId: decideur.responsableId };
  return {
    type: "PERMISSION",
    permission: decideur.type === "DG" ? PERMISSION_DG_JUSTIFICATION : PERMISSION_RH_POINTAGE,
    exclureUserId: collaborateurId,
  };
}

/** Qui examinera la justification, pour l'écran du collaborateur. */
export function libelleDecideur(decideur: DecideurJustification, responsableNom: string | null): string {
  if (decideur.type === "RESPONSABLE") return `votre responsable de service${responsableNom ? `, ${responsableNom}` : ""}`;
  return decideur.type === "DG" ? "le DG" : "la RH";
}

// ───────────────────────── Lot 5 : envois, relances et clôture (tâche planifiée) ─────────────────────────

/** Paramètres de relance réglés par la RH (`ParametrageHoraire`, lot 2) et fin de journée. */
export interface ParametresRelanceJustification {
  delaiDemandeJustificationMinutes: number;
  intervalleRelanceJustificationMinutes: number;
  /** Nombre total d'envois au collaborateur, premier compris. */
  nombreMaxRelancesJustification: number;
  /** « HH:MM » : fin de journée, borne des relances et moment de la clôture. */
  heureFinApresMidi: string;
}

export interface EtatRelanceJustification {
  statut: StatutJustificationPointage;
  nombreEnvois: number;
  dernierEnvoiAt: Date | null;
  /** Heure du pointage concerné (arrivée en retard ou départ anticipé). */
  heurePointage: Date;
}

export type ActionRelanceJustification = { type: "ENVOI"; numero: number } | { type: "CLOTURE" } | { type: "AUCUNE" };

const MINUTE_MS = 60 * 1000;

/** Fin de journée du pointage : le jour du pointage à `heureFinApresMidi`, en heure locale du serveur (comme le module). */
export function finJourneeJustification(heurePointage: Date, heureFinApresMidi: string): Date {
  const [h, m] = heureFinApresMidi.split(":").map(Number);
  const fin = new Date(heurePointage);
  fin.setHours(h || 0, m || 0, 0, 0);
  return fin;
}

/**
 * Prochaine action de la tâche planifiée pour une justification (plan, lot 5) :
 * 1. statut autre que EN_ATTENTE → AUCUNE ;
 * 2. aucun envoi et `now ≥ pointage + délai` → ENVOI(1) ;
 * 3. `0 < envois < maximum`, avant la fin de journée, `now ≥ dernier envoi + intervalle` → ENVOI(envois + 1) ;
 * 4. au moins un envoi, `now ≥ fin de journée` et `now ≥ dernier envoi + intervalle` → CLOTURE ;
 * 5. sinon AUCUNE.
 * Une tâche en panne rattrape d'elle-même : un envoi en retard part au premier passage, la clôture un intervalle plus tard.
 */
export function prochaineActionJustification(
  etat: EtatRelanceJustification,
  params: ParametresRelanceJustification,
  now: Date
): ActionRelanceJustification {
  if (etat.statut !== "EN_ATTENTE") return { type: "AUCUNE" };
  const t = now.getTime();
  const finJournee = finJourneeJustification(etat.heurePointage, params.heureFinApresMidi).getTime();
  if (etat.nombreEnvois === 0) {
    return t >= etat.heurePointage.getTime() + params.delaiDemandeJustificationMinutes * MINUTE_MS
      ? { type: "ENVOI", numero: 1 }
      : { type: "AUCUNE" };
  }
  const prochainPossible = (etat.dernierEnvoiAt ?? etat.heurePointage).getTime() + params.intervalleRelanceJustificationMinutes * MINUTE_MS;
  if (etat.nombreEnvois < params.nombreMaxRelancesJustification && t < finJournee && t >= prochainPossible) {
    return { type: "ENVOI", numero: etat.nombreEnvois + 1 };
  }
  if (t >= finJournee && t >= prochainPossible) return { type: "CLOTURE" };
  return { type: "AUCUNE" };
}

/** Au collaborateur : demande (1er envoi) ou relance de justification. */
export function messageDemandeJustification(params: { pointage: PointageJustifie; numero: number; nombreMax: number }): MessageJustification {
  const { pointage, numero, nombreMax } = params;
  const objet = descriptionAnomalie(pointage);
  if (numero === 1) {
    return {
      titre: pointage.type === "ARRIVEE" ? "Justifiez votre retard" : "Justifiez votre départ anticipé",
      message: `Merci de justifier votre ${objet}. Ouvrez le lien pour saisir votre motif.`,
    };
  }
  return {
    titre: `Rappel (${numero}/${nombreMax}) : justification attendue`,
    message: `Votre ${objet} n'est toujours pas justifié. Ouvrez le lien pour saisir votre motif.`,
  };
}

/** Au décideur, au premier envoi : le collaborateur doit justifier. */
export function messageAlerteDecideurJustification(params: {
  collaborateurNom: string;
  serviceNom: string | null;
  decideur: DecideurJustification;
  pointage: PointageJustifie;
}): MessageJustification {
  const { collaborateurNom, serviceNom, decideur, pointage } = params;
  const qui = presentationCollaborateur(collaborateurNom, serviceNom, decideur);
  const fait = pointage.type === "ARRIVEE" ? `est arrivé en retard de ${pointage.minutesRetard ?? 0} min` : "est parti en avance";
  return {
    titre: pointage.type === "ARRIVEE" ? "Retard à justifier" : "Départ anticipé à justifier",
    message: `${qui} ${fait} le ${dateCourte(pointage.heure)} (${heureCourte(pointage.heure)}). Il doit justifier ; vous déciderez de son motif.${
      decideur.type === "DG" ? " (Aucun autre compte RH ne peut décider.)" : ""
    }`,
  };
}

/** Au décideur, à la clôture : le collaborateur n'a pas justifié (il le peut encore). */
export function messageClotureJustification(params: {
  collaborateurNom: string;
  serviceNom: string | null;
  decideur: DecideurJustification;
  pointage: PointageJustifie;
}): MessageJustification {
  const { collaborateurNom, serviceNom, decideur, pointage } = params;
  const qui = presentationCollaborateur(collaborateurNom, serviceNom, decideur);
  return {
    titre: "Justification non reçue",
    message: `${qui} n'a pas justifié son ${descriptionAnomalie(pointage)}. Il peut encore le faire.`,
  };
}

// ───────────────────────── Lot 7 : lecture RH (présence du jour, reporting, export) ─────────────────────────

/** Justification telle que lue avec un pointage (statut réel, motif saisi, auteur de la décision). */
export interface JustificationLue {
  statut: StatutJustificationPointage;
  motif: string | null;
  decideur: { fullName: string } | null;
}

export interface JustificationAffichee {
  /** `null` : pointage sans justification (à l'heure, ou ancien pointage antérieur au lot 3). */
  statut: StatutJustificationPointage | null;
  libelle: string;
  /** Motif de la justification, sinon l'ancien motif saisi au pointage (historique). */
  motif: string | null;
  /** Auteur de la décision, seulement une fois acceptée ou refusée. */
  decideePar: string | null;
}

/**
 * Ce que les écrans RH et l'export affichent pour un pointage (Pointage V2, lot 7) — UNE seule source : statut réel de
 * `JustificationPointage`, motif de la justification avec repli sur `Pointage.motif`, « Décidée par ».
 */
export function justificationAffichee(pointage: { motif: string | null; justification: JustificationLue | null }): JustificationAffichee {
  const j = pointage.justification;
  if (!j) return { statut: null, libelle: "—", motif: pointage.motif ?? null, decideePar: null };
  const decidee = j.statut === "ACCEPTEE" || j.statut === "REFUSEE";
  return {
    statut: j.statut,
    libelle: LIBELLE_STATUT_JUSTIFICATION[j.statut],
    motif: j.motif ?? pointage.motif ?? null,
    decideePar: decidee ? (j.decideur?.fullName ?? null) : null,
  };
}

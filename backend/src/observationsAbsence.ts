// Observations sur les demandes de congé (C3, consignes du 2026-10-16). Fonctions PURES.
//
// - La RH (comme le responsable) ajoute une observation, facultative, AU MOMENT de sa décision.
// - Le DG (permission `treso.decider_dg` lue sur le RÔLE) peut en ajouter une À TOUT MOMENT, sans bloquer ni changer le
//   statut : ce n'est pas une étape du circuit, c'est un avis.
// - AJOUT SEUL : jamais de modification ni de suppression (déclencheur en base, voir la migration).
// - Visibles du responsable, de la RH, du DG et du demandeur (avec le nom de l'auteur) ; le demandeur n'en ajoute pas.

import { PERMISSION_DG_ABSENCE, nettoyerMotifAbsence, type ActeurAbsence } from "./circuitAbsence";

export const OBSERVATION_MAX = 500;

export type EtapeObservation = "RESPONSABLE" | "RH" | "DG";

export const LIBELLE_ETAPE_OBSERVATION: Record<EtapeObservation, string> = {
  RESPONSABLE: "Responsable du service",
  RH: "RH",
  DG: "DG",
};

export const MESSAGE_OBSERVATION_RESERVEE_DG = "Seul le DG peut ajouter une observation en dehors d'une décision.";
export const MESSAGE_OBSERVATION_DG_PROPRE_DEMANDE = "Vous ne pouvez pas ajouter d'observation à votre propre demande.";

/**
 * Texte d'une observation. `facultative` : un texte vide donne `{ ok: true, texte: null }` (aucune observation) ; sinon
 * un texte vide est refusé. Espaces nettoyés ; 500 caractères au plus.
 */
export function controlerObservation(
  brut: unknown,
  facultative: boolean
): { ok: true; texte: string | null } | { ok: false; erreur: string } {
  if (brut === undefined || brut === null) {
    return facultative ? { ok: true, texte: null } : { ok: false, erreur: "L'observation ne peut pas être vide." };
  }
  if (typeof brut !== "string") return { ok: false, erreur: "Observation invalide." };
  const texte = nettoyerMotifAbsence(brut);
  if (texte.length === 0) {
    return facultative ? { ok: true, texte: null } : { ok: false, erreur: "L'observation ne peut pas être vide." };
  }
  if (texte.length > OBSERVATION_MAX) {
    return { ok: false, erreur: `L'observation ne doit pas dépasser ${OBSERVATION_MAX} caractères.` };
  }
  return { ok: true, texte };
}

/** Le message du refus si cet acteur ne peut pas ajouter d'observation hors décision, sinon `null`. */
export function refusObservationDG(p: { acteur: ActeurAbsence; demandeurId: string }): string | null {
  if (!p.acteur.rolePermissions.includes(PERMISSION_DG_ABSENCE)) return MESSAGE_OBSERVATION_RESERVEE_DG;
  if (p.acteur.id === p.demandeurId) return MESSAGE_OBSERVATION_DG_PROPRE_DEMANDE;
  return null;
}

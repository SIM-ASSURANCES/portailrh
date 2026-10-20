// Congés — destinataires des notifications d'annulation (module simplifié, 2026-10-20). Logique PURE : aucun accès base.

import type { StatutCircuitConge } from "./circuitConge";

export interface ParamsDestinatairesAnnulationConge {
  /** Statut AVANT l'annulation (`DecisionConge.ancienStatut`). */
  ancienStatut: StatutCircuitConge;
  acteurId: string;
  demandeurId: string;
  /** Comptes actifs dont le RÔLE porte `conges.valider_rh`. */
  comptesRH: readonly string[];
  /** `destinatairesEtapeConge(ancienStatut, contexte)` : qui attendait pour décider. */
  destinatairesEtapeEnCours: readonly string[];
}

/**
 * Qui prévenir lorsqu'un congé est annulé :
 *   - ancien statut `VALIDEE` → tous les comptes RH ;
 *   - ancien statut `EN_ATTENTE_RESPONSABLE` ou `EN_ATTENTE_RH` → ceux qui devaient décider (`destinatairesEtapeEnCours`) ;
 *   - ancien statut `MODIFICATION_DEMANDEE` → personne de plus ;
 *   - dans tous les cas : plus le demandeur ; jamais l'auteur de l'annulation ; sans doublon.
 */
export function destinatairesAnnulationConge(p: ParamsDestinatairesAnnulationConge): string[] {
  const concernes =
    p.ancienStatut === "VALIDEE"
      ? p.comptesRH
      : p.ancienStatut === "EN_ATTENTE_RESPONSABLE" || p.ancienStatut === "EN_ATTENTE_RH"
        ? p.destinatairesEtapeEnCours
        : [];
  return [...new Set([p.demandeurId, ...concernes])].filter((id) => id !== p.acteurId);
}


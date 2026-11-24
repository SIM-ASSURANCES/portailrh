// Libellés de la rubrique « Clients et créances » de Gestion Compta (lot GC-7). Propres au module (règle d'indépendance).

import type { EtatAfficheEcheance } from "backend";

export const LIBELLE_FRACTIONNEMENT_CPT: Record<string, string> = {
  COMPTANT: "Au comptant",
  MENSUEL: "Mensuel",
  TRIMESTRIEL: "Trimestriel",
  SEMESTRIEL: "Semestriel",
  LIBRE: "Libre",
};

export const VARIANTE_ETAT_ECHEANCE_CPT: Record<EtatAfficheEcheance, "neutral" | "info" | "success" | "warning" | "danger"> = {
  A_VENIR: "neutral",
  DUE: "info",
  EN_RETARD: "danger",
  PAYEE: "success",
  PARTIELLEMENT_PAYEE: "warning",
  ANNULEE: "neutral",
};

export const LIBELLE_STATUT_RATTACHEMENT_CPT: Record<string, string> = {
  PROPOSE: "Proposé",
  CONFIRME: "Confirmé par le commercial",
  VALIDE: "Validé",
  REJETE: "Rejeté",
};

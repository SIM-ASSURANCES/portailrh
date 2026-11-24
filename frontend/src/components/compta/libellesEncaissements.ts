// Libellés et formats d'affichage de la rubrique « Encaissements » de Gestion Compta (lot GC-4e). Propres au module : aucun import des
// libellés d'Encaissements (règle d'indépendance, cptIndependance.test.ts). Les formats de montant et de date sont ceux de la
// rubrique « Production » (`libellesProduction.ts`, du même module).

import { libelleAnomalieProduction } from "./libellesProduction";

export const LIBELLE_TYPE_FLUX_CPT: Record<string, string> = {
  ENCAISSEMENT: "Encaissement",
  VIREMENT_INTERNE_ENTRANT: "Virement interne reçu",
  VIREMENT_INTERNE_SORTANT: "Virement interne émis",
  REMBOURSEMENT: "Remboursement",
  TEST: "Transaction test",
  FRAIS: "Frais",
  AUTRE_DEBIT: "Autre débit",
};

export const LIBELLE_STATUT_ENCAISSEMENT_CPT: Record<string, string> = {
  A_RATTACHER: "À rattacher",
  SOLDE: "Soldé",
  SANS_OBJET: "Sans objet",
};

export const LIBELLE_TYPE_COMPTE_CPT: Record<string, string> = {
  WAVE_BUSINESS: "Wave Business",
  WAVE_HORS_BUSINESS: "Wave (hors Business)",
  BANQUE: "Banque",
  MICROFINANCE: "Microfinance",
  AGREGATEUR: "PeyaPay",
  CAISSE: "Caisse",
};

/** Anomalies propres aux relevés ; les autres codes (cellule illisible…) viennent des libellés de la production. */
export const LIBELLE_ANOMALIE_RELEVE: Record<string, string> = {
  REFERENCE_MANQUANTE: "Référence de la ligne manquante",
  REFERENCE_EN_DOUBLE: "Référence en double dans le fichier",
  DATE_MANQUANTE: "Date manquante ou illisible",
  DATE_FUTURE: "Date dans le futur",
  HORS_PERIODE: "Date hors du mois du relevé",
  MONTANT_MANQUANT: "Montant manquant ou illisible",
  MONTANT_NUL: "Montant nul",
  FRAIS_SUPERIEURS_AU_MONTANT: "Frais supérieurs au montant",
  NET_INCOHERENT: "Net différent de brut − frais",
  PERIODE_CLOTUREE: "Mois clôturé",
  REMBOURSEMENT_RECU: "Remboursement reçu",
  VIREMENT_AMBIGU: "Virement interne ambigu",
};

export function libelleAnomalieReleve(type: string): string {
  return LIBELLE_ANOMALIE_RELEVE[type] ?? libelleAnomalieProduction(type);
}

/** Premier jour d'un mois (colonne SQL DATE) → « mars 2026 ». */
export function formaterMoisCpt(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(`${date.slice(0, 10)}T00:00:00.000Z`) : date;
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", month: "long", year: "numeric" }).format(d);
}

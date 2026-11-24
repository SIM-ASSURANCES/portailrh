// Libellés et formats d'affichage de la rubrique « Production » de Gestion Compta (lot GC-3f). Propres au module : aucun import des
// libellés d'Encaissements (règle d'indépendance, cptIndependance.test.ts).

/** Montant décimal (« 120000.00 », « 506486 ») → « 120 000 » ; les centimes ne sont montrés que s'il y en a. */
export function formaterMontantCpt(valeur: string | number | { toString(): string } | null | undefined): string {
  if (valeur === null || valeur === undefined) return "—";
  const nombre = Number(valeur.toString());
  if (!Number.isFinite(nombre)) return "—";
  return nombre.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Date calendaire (colonne SQL DATE, minuit UTC) → « 31/12/2026 ». */
export function formaterDateCpt(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

/** Instant (création d'un import…) → « 31/12/2026 14:05 », à l'heure d'Abidjan. */
export function formaterDateHeureCpt(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Abidjan",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Type d'anomalie (`CptAnomalie.type`) → phrase courte. Un type inconnu s'affiche tel quel. */
export const LIBELLE_ANOMALIE_PRODUCTION: Record<string, string> = {
  NUM_POLICE_MANQUANT: "Numéro de police manquant",
  PRODUIT_MANQUANT: "Produit manquant",
  PRODUIT_INCONNU: "Produit inconnu",
  PARTENAIRE_INCONNU: "Partenaire inconnu",
  DATE_MANQUANTE: "Date manquante",
  DATE_INVALIDE: "Date invalide",
  DATES_INCOHERENTES: "Dates incohérentes",
  PRIME_MANQUANTE: "Prime manquante",
  MONTANT_NEGATIF: "Montant négatif",
  MONTANTS_INCOHERENTS: "Montants incohérents",
  MONTANT_DIFFERENT_TARIF: "Montant différent du tarif",
  PRIME_OFFERTE: "Prime offerte",
  REFERENCE_MANQUANTE: "Référence de paiement manquante",
  REFERENCE_DEJA_UTILISEE: "Référence déjà utilisée",
  MODE_INCOHERENT_REFERENCE: "Mode incohérent avec la référence",
  REFERENCE_WAVE_NON_CONFORME: "Référence Wave non conforme",
  MONTANT_PAYE_SUPERIEUR_PRIME: "Montant payé supérieur à la prime",
  DATE_PAIEMENT_FUTURE: "Date de paiement dans le futur",
  TYPE_OPERATION_INCONNU: "Type d'opération inconnu",
  TYPE_OPERATION_MANQUANT: "Type d'opération absent",
  LIGNE_EN_DOUBLE: "Ligne en double",
  SAISIE_APRES_CLOTURE: "Ligne dans un mois clôturé",
  CONTRAT_DIFFERENT_DU_FICHIER: "Contrat différent du fichier",
  ACTE_A_TRAITER: "Acte à traiter",
  ACTE_SANS_CONTRAT: "Acte sur une police inconnue",
  ECHEANCIER_NON_GENERE: "Échéancier non généré",
  MONTANTS_NON_ENREGISTRABLES: "Montants non enregistrables",
  CELLULE_ILLISIBLE: "Cellule illisible",
};

export function libelleAnomalieProduction(type: string): string {
  return LIBELLE_ANOMALIE_PRODUCTION[type] ?? type;
}

export const LIBELLE_STATUT_CONTRAT_CPT: Record<string, string> = {
  EN_COURS: "En cours",
  ECHU: "Échu",
  ANNULE: "Annulé",
  RESILIE: "Résilié",
};

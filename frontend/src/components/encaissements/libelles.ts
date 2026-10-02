/**
 * Libellés en clair du module Encaissements — jamais un code technique affiché à l'écran (modes de paiement, types de
 * signalement). Partagés par l'écran d'import, le rapport et l'historique.
 */

/** Codes produits par `normaliserMode` (encImportLecture.ts) ; tout autre libellé du fichier est affiché tel quel. */
const MODE_LIBELLE: Record<string, string> = {
  WAVE: "Wave",
  OM: "Orange Money",
  MTN: "MTN Mobile Money",
  CHQ: "Chèque",
  VIR: "Virement",
  CB: "Carte bancaire",
  MOB: "Mobile money (Moov, Flooz…)",
};

export function libelleMode(mode: string | null | undefined): string {
  if (!mode) return "—";
  const connu = MODE_LIBELLE[mode];
  if (connu) return connu;
  return mode.charAt(0) + mode.slice(1).toLowerCase();
}

/** Clés = valeurs de l'enum Prisma `EncAnalyseSignalement`. */
const ANALYSE_LIBELLE: Record<string, string> = {
  DEJA_PRESENT: "Déjà présent",
  DOUBLON_POSSIBLE: "Doublon possible",
  A_COMPLETER: "À compléter",
  REFERENCE_MANQUANTE: "Référence manquante",
  REF_WAVE_NON_CONFORME: "Référence Wave non conforme",
  AJOUTE: "Paiement ajouté (à confirmer)",
  SANS_PAIEMENT: "Police revenue sans paiement",
  PRIME_MODIFIEE: "Prime modifiée (avenant possible)",
  INCOHERENCE: "Incohérence des montants",
  ECART_TAUX: "Écart de taux de contrôle",
  LIGNE_ANNULEE_REJETEE: "Ligne annulée, rejetée",
  ANNULATION_EN_ATTENTE_L4: "Annulation en attente",
  BRANCHE_INCONNUE: "Branche inconnue",
};

export function libelleAnalyse(analyse: string): string {
  return ANALYSE_LIBELLE[analyse] ?? analyse;
}

/** Affichage à l'unité FCFA (calcul et stockage restent au centime — décision du 2026-09-28). */
export function formatFcfa(valeur: number | string | null | undefined): string {
  if (valeur === null || valeur === undefined || valeur === "") return "—";
  const n = Math.round(Number(valeur));
  return `${n.toLocaleString("fr-FR")} FCFA`;
}

export function formatDateCourte(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("fr-FR", { timeZone: "UTC" });
}

export function formatDateHeure(date: Date | string): string {
  return new Date(date).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Abidjan" });
}

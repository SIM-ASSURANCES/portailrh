/**
 * Libellés en clair du module Encaissements — jamais un code technique affiché à l'écran (modes de paiement, types de
 * signalement, source et statut d'un paiement). Partagés par l'import, le rapport, la recherche et la fiche police.
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

/** Clés = valeurs de l'enum Prisma `EncSourceEncaissement`. */
const SOURCE_LIBELLE: Record<string, string> = {
  FICHIER: "Fichier de production",
  SAISIE: "Saisie à l'écran",
};

export function libelleSource(source: string): string {
  return SOURCE_LIBELLE[source] ?? source;
}

/** Clés = valeurs de l'enum Prisma `EncStatutEncaissement`. */
export const STATUT_ENCAISSEMENT: Record<string, { libelle: string; variant: "warning" | "success" | "danger" }> = {
  A_CONFIRMER: { libelle: "À confirmer", variant: "warning" },
  CONFIRME: { libelle: "Confirmé", variant: "success" },
  NON_RECU: { libelle: "Non reçu", variant: "danger" },
};

/** Situation d'un contrat (paiements confirmés seulement) : jamais un reste dû négatif, « Trop-perçu » à la place. */
export function libelleSituation(situation: { type: "reste" | "trop" | "solde"; montant: string }): string {
  if (situation.type === "trop") return `Trop-perçu : ${formatFcfa(situation.montant)}`;
  if (situation.type === "reste") return `Reste dû : ${formatFcfa(situation.montant)}`;
  return "Soldé";
}

/** Paiement tel qu'indiqué dans le fichier (`EncSignalement.paiementIndique`), en une ligne lisible. */
export function paiementLisible(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const p = json as { datePaiement?: string | null; mode?: string | null; montant?: string | null; reference?: string | null };
  const morceaux = [
    p.datePaiement ? formatDateCourte(p.datePaiement) : null,
    p.mode ? libelleMode(p.mode) : null,
    p.montant ? formatFcfa(p.montant) : null,
    p.reference ? `réf. ${p.reference}` : null,
  ].filter(Boolean);
  return morceaux.length > 0 ? morceaux.join(" · ") : null;
}

/** État d'un signalement d'import : à traiter, pour information, ou traité (par qui, quand, comment). */
export function etatSignalement(s: {
  statut: string;
  traiteAt?: Date | null;
  traitePar?: { fullName: string } | null;
  resolution?: string | null;
}): string {
  if (s.statut === "A_TRAITER") return "À traiter";
  if (s.statut === "INFO") return "Pour information";
  const qui = s.traitePar ? ` par ${s.traitePar.fullName}` : "";
  const quand = s.traiteAt ? ` le ${formatDateHeure(s.traiteAt)}` : "";
  return `Traité${qui}${quand}${s.resolution ? ` (${s.resolution})` : ""}`;
}

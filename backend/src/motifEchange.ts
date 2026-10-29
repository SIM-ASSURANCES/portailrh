// Motif obligatoire dans les DEUX SENS entre la Finance et le DG (lot M, 2026-10-29). UNE seule règle, UNE seule liste :
// chaque envoi de la Finance au DG et chaque réponse du DG à la Finance porte un motif de 10 à 300 caractères, vérifié CÔTÉ
// SERVEUR par `refusMotifEchange` (un appel direct sans motif est refusé), conservé avec l'action (colonnes `motifSoumissionDG`
// / `motifDecisionDG`, historique), montré dans l'historique, le parcours de l'article, les notifications et le reporting.
//
// Module PUR, sûr pour un Client Component (réexporté par `backend/client`).

export const MOTIF_ECHANGE_MIN = 10;
export const MOTIF_ECHANGE_MAX = 300;
/** Affiché pour un échange antérieur au lot M (jamais marqué anormal, jamais modifié). */
export const LIBELLE_MOTIF_NON_RENSEIGNE = "Non renseigné";

export type SensEchange = "FINANCE_VERS_DG" | "DG_VERS_FINANCE";

export interface EchangeAvecMotif {
  /** Code d'action de signature / d'historique qui porte l'échange. */
  code: string;
  sens: SensEchange;
  /** Libellé affiché dans les messages (« la soumission au DG »). */
  libelle: string;
}

/**
 * Tous les envois Finance → DG et toutes les réponses DG → Finance du code (audit du lot M). Toute nouvelle action qui envoie au
 * DG ou répond à la Finance doit être ajoutée ici ET appeler `refusMotifEchange`.
 */
export const ECHANGES_FINANCE_DG: readonly EchangeAvecMotif[] = [
  // Finance → DG
  { code: "soumission_dg", sens: "FINANCE_VERS_DG", libelle: "la soumission de la demande au DG" },
  { code: "soumission_lignes_dg", sens: "FINANCE_VERS_DG", libelle: "la soumission d'articles au DG" },
  { code: "resoumission_dg", sens: "FINANCE_VERS_DG", libelle: "la resoumission au DG" },
  { code: "resoumission_approbation_dg", sens: "FINANCE_VERS_DG", libelle: "la resoumission de la validation complète au DG" },
  { code: "envoi_direct_dg", sens: "FINANCE_VERS_DG", libelle: "l'envoi de la demande au DG" },
  { code: "budget_soumission_caisse", sens: "FINANCE_VERS_DG", libelle: "la soumission des seuils de caisse au DG" },
  { code: "budget_soumission_categories", sens: "FINANCE_VERS_DG", libelle: "la soumission des budgets de catégorie au DG" },
  { code: "demande_confirmation_depassement", sens: "FINANCE_VERS_DG", libelle: "la demande de confirmation du dépassement de budget" },
  // DG → Finance
  { code: "validation_dg", sens: "DG_VERS_FINANCE", libelle: "la validation du DG" },
  { code: "rejet_dg", sens: "DG_VERS_FINANCE", libelle: "le rejet du DG" },
  { code: "rejet_demande_dg", sens: "DG_VERS_FINANCE", libelle: "le rejet de la demande par le DG" },
  { code: "decision_ligne_dg", sens: "DG_VERS_FINANCE", libelle: "la décision du DG sur l'article" },
  { code: "decision_lignes", sens: "DG_VERS_FINANCE", libelle: "la décision du DG sur les articles" },
  { code: "validation_depense_directe", sens: "DG_VERS_FINANCE", libelle: "la décision du DG sur la dépense" },
  { code: "rejet_reliquat", sens: "DG_VERS_FINANCE", libelle: "le rejet du reliquat par le DG" },
  { code: "rejet_demande", sens: "DG_VERS_FINANCE", libelle: "le rejet de la demande par le DG" },
  { code: "approbation_cloture", sens: "DG_VERS_FINANCE", libelle: "l'approbation de clôture du DG" },
  { code: "rejet_approbation_cloture", sens: "DG_VERS_FINANCE", libelle: "le rejet de la validation complète par le DG" },
  { code: "annulation_approbation_cloture", sens: "DG_VERS_FINANCE", libelle: "l'annulation de la validation complète par le DG" },
  { code: "confirmation_depassement_budget", sens: "DG_VERS_FINANCE", libelle: "la confirmation du dépassement de budget" },
  { code: "budget_decision_caisse", sens: "DG_VERS_FINANCE", libelle: "la décision du DG sur les seuils de caisse" },
  { code: "budget_decision_categories", sens: "DG_VERS_FINANCE", libelle: "la décision du DG sur les budgets de catégorie" },
  { code: "reprise_etape", sens: "DG_VERS_FINANCE", libelle: "le renvoi à la Finance" },
];

/** Motif nettoyé (espaces de bord retirés) — la forme qui est enregistrée. */
export function nettoyerMotifEchange(motif: unknown): string {
  return typeof motif === "string" ? motif.trim() : "";
}

/**
 * `null` si le motif est valide (10 à 300 caractères après nettoyage), sinon la phrase de refus. `objet` complète le message
 * (« la validation du DG ») ; sans lui, la phrase reste générique.
 */
export function refusMotifEchange(motif: unknown, objet?: string): string | null {
  const m = nettoyerMotifEchange(motif);
  const pour = objet ? ` pour ${objet}` : "";
  if (m.length === 0) return `Le motif est obligatoire${pour} (${MOTIF_ECHANGE_MIN} caractères minimum).`;
  if (m.length < MOTIF_ECHANGE_MIN) return `Le motif${pour} doit contenir au moins ${MOTIF_ECHANGE_MIN} caractères (${m.length} saisis).`;
  if (m.length > MOTIF_ECHANGE_MAX) return `Le motif${pour} ne doit pas dépasser ${MOTIF_ECHANGE_MAX} caractères (${m.length} saisis).`;
  return null;
}

/** Libellé du motif d'un échange déjà passé : le motif, ou « Non renseigné » (échange antérieur au lot M). */
export function motifOuNonRenseigne(motif: string | null | undefined): string {
  const m = nettoyerMotifEchange(motif);
  return m === "" ? LIBELLE_MOTIF_NON_RENSEIGNE : m;
}

/** Texte de motif à ajouter à une phrase d'historique ou de notification (« — motif : … »). */
export function suffixeMotifEchange(motif: string | null | undefined): string {
  return ` — motif : ${motifOuNonRenseigne(motif)}`;
}

/** Aide courte sous un champ de motif : « 10 à 300 caractères (42 saisis). » */
export function aideMotifEchange(motif: string): string {
  const n = nettoyerMotifEchange(motif).length;
  return `${MOTIF_ECHANGE_MIN} à ${MOTIF_ECHANGE_MAX} caractères (${n} saisis).`;
}

/** `true` si le motif saisi est acceptable (pour griser un bouton ; le serveur revérifie toujours). */
export function motifEchangeValide(motif: unknown): boolean {
  return refusMotifEchange(motif) === null;
}

/**
 * Actions d'HISTORIQUE (`HistoriqueEntry.action`) qui portent un échange Finance ↔ DG. Une entrée de cette liste enregistrée AVANT le
 * lot M n'a pas de motif : à l'affichage on lui ajoute « motif : Non renseigné » (jamais marqué anormal, rien n'est réécrit en base).
 */
export const ACTIONS_HISTORIQUE_ECHANGE_DG: ReadonlySet<string> = new Set([
  "soumission_dg",
  "resoumission_dg",
  "validation_dg",
  "rejet_dg",
  "soumission_lignes_dg",
  "validation_ligne_dg",
  "refus_ligne_dg",
  "validation_complete_dg",
  "rejet_validation_complete",
  "annulation_validation_complete",
  "resoumission_validation_complete",
  "demande_confirmation_depassement",
  "confirmation_depassement_budget",
  "reprise_etape",
  "budget_soumis",
  "budget_valide",
  "budget_refuse",
]);

/**
 * Vocabulaire uniforme « Rejeter » à la LECTURE d'un texte d'historique enregistré avant le lot M (rien n'est réécrit en base) :
 * seules les formulations d'origine du portail sont converties (« Refusé par le DG », « ligne … refusée », « après refus »).
 */
export function vocabulaireRejet(texte: string): string {
  return texte
    .replace(/\bRefusé par le DG/g, "Rejeté par le DG")
    .replace(/(ligne «[^»]*» )refusée\b/g, "$1rejetée")
    .replace(/\baprès refus :/g, "après rejet :")
    .replace(/\bmotif du refus\b/gi, (m) => (m[0] === "M" ? "Motif du rejet" : "motif du rejet"));
}

/** Texte d'historique à afficher : le détail enregistré (vocabulaire uniformisé), complété de « motif : Non renseigné » pour un échange antérieur au lot M. */
export function detailHistoriqueEchange(action: string, detail: string | null | undefined): string | null {
  if (!ACTIONS_HISTORIQUE_ECHANGE_DG.has(action)) return detail == null ? null : vocabulaireRejet(detail);
  const d = vocabulaireRejet((detail ?? "").trim());
  if (/motif/i.test(d)) return d;
  return `${d}${d === "" ? "Motif : " : " — motif : "}${LIBELLE_MOTIF_NON_RENSEIGNE}`;
}

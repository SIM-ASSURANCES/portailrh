// Lot L (2026-10-27) — signature manuscrite : constantes et libellés SANS dépendance Node (sûrs pour un Client Component).
// La validation de l'image (zlib) vit dans `signature.ts`, jamais importé côté navigateur.
//
// Ce que la signature est, et n'est pas : une TRAÇABILITÉ INTERNE (qui a fait l'action, avec quelle signature enregistrée, quand,
// depuis quelle adresse). Ce n'est PAS une signature électronique qualifiée : ne jamais la présenter comme telle.

export const SIGNATURE_LARGEUR_MIN = 200;
export const SIGNATURE_LARGEUR_MAX = 1200;
export const SIGNATURE_HAUTEUR_MIN = 60;
export const SIGNATURE_HAUTEUR_MAX = 600;
/** Taille maximale de l'image PNG (octets). */
export const SIGNATURE_TAILLE_MAX = 100 * 1024;
/** Pixels « encrés » minimum, et étendue minimale du tracé : en dessous, la signature est refusée comme vide. */
export const SIGNATURE_ENCRE_MIN = 150;
export const SIGNATURE_ETENDUE_LARGEUR_MIN = 40;
export const SIGNATURE_ETENDUE_HAUTEUR_MIN = 10;

/** Dimensions du cadre de dessin (le PNG envoyé fait exactement cette taille). */
export const SIGNATURE_CADRE_LARGEUR = 600;
export const SIGNATURE_CADRE_HAUTEUR = 200;

export const MESSAGE_SIGNATURE_REQUISE =
  "Vous devez d'abord enregistrer votre signature (menu « Mon profil ») avant de signer cette action.";

/** Clé du repère de mise en service (`MarqueurUnique`) : tout ce qui précède est « Antérieur à la signature ». */
export const CLE_MARQUEUR_SIGNATURES = "signatures.mise_en_service";

export const LIBELLE_ANTERIEUR_SIGNATURE = "Antérieur à la signature";

export const MENTION_SIGNATURE_INTERNE =
  "Signature manuscrite enregistrée : traçabilité interne, sans valeur de signature électronique qualifiée.";

/** Rappel affiché sur le bouton d'une action signée (« ce qui est signé »). */
export const RAPPEL_SIGNATURE_PAR_DEFAUT =
  "Signer et valider : cette action sera signée avec votre signature enregistrée (date, heure et adresse IP conservées).";

/** « Signé par X » ou « signé par X, au nom de Y » (signataire = le compte connecté, titulaire = propriétaire de la permission). */
export function libelleSignature(p: { signataire: string; auNomDe?: string | null }): string {
  return p.auNomDe && p.auNomDe !== p.signataire
    ? `signé par ${p.signataire}, au nom de ${p.auNomDe}`
    : `signé par ${p.signataire}`;
}

/** Actions signées (code → ce qui est signé, en clair). Source unique pour les rappels et le rapport. */
export const ACTIONS_SIGNEES: Record<string, string> = {
  validation_service: "Validation de l'étape Service",
  rejet_service: "Rejet à l'étape Service",
  rejet_demande_dg: "Rejet de la demande par le DG",
  soumission_dg: "Soumission de la demande au DG",
  soumission_lignes_dg: "Soumission d'articles au DG",
  decision_ligne_dg: "Décision du DG sur un article",
  resoumission_dg: "Resoumission au DG",
  validation_dg: "Validation de la demande par le DG",
  rejet_dg: "Rejet par le DG",
  reorientation_service: "Réorientation de l'étape Service",
  reprise_etape: "Reprise à l'étape précédente",
  decision_lignes: "Décision de la Finance sur les articles",
  validation_depense_directe: "Validation d'une dépense directe",
  rejet_reliquat: "Rejet du reliquat",
  rejet_demande: "Rejet de la demande",
  cloture: "Clôture de la demande",
  approbation_cloture: "Approbation de clôture par le DG",
  rejet_approbation_cloture: "Rejet de l'approbation de clôture",
  annulation_approbation_cloture: "Annulation de l'approbation de clôture",
  resoumission_approbation_dg: "Resoumission de la validation complète au DG",
  confirmation_reglement: "Confirmation (décaissement) d'un règlement",
  annulation_reglement: "Annulation d'un règlement",
  reception_retour: "Réception d'un retour de caisse",
  declaration_retour_assistant: "Déclaration d'un retour de caisse par l'Assistant Finance",
  validation_remboursement: "Validation d'un remboursement de retour",
  rejet_remboursement: "Rejet d'un remboursement de retour",
  validation_retour_exceptionnel: "Validation d'un retour exceptionnel post-clôture",
  rejet_retour_exceptionnel: "Rejet d'un retour exceptionnel post-clôture",
  retour_externe: "Enregistrement d'un retour externe",
  alimentation_caisse: "Alimentation de la caisse",
  solde_ouverture: "Définition ou correction du solde d'ouverture de la caisse",
  depense_directe: "Création d'une dépense directe",
  budget_soumission_caisse: "Soumission des seuils du budget de caisse",
  budget_soumission_categories: "Soumission de budgets de catégorie",
  budget_decision_caisse: "Décision du DG sur les seuils du budget de caisse",
  budget_decision_categories: "Décision du DG sur des budgets de catégorie",
  confirmation_depassement_budget: "Confirmation d'un dépassement de budget",
};

/** Permissions dont les actions sont signées : un compte qui en porte une (ou qui est responsable de service) voit le bandeau « Créer ma signature ». */
export const PERMISSIONS_SIGNATAIRES: readonly string[] = [
  "treso.decider_finance",
  "treso.decider_dg",
  "treso.soumettre_dg",
  "treso.valider_demande",
  "treso.approuver_validation_complete",
  "treso.effectuer_reglement",
  "treso.receptionner_retour",
  "treso.cloturer_demande",
  "treso.alimenter_caisse",
  "treso.corriger_solde_ouverture",
  "treso.saisir_depense_directe",
  "treso.creer_retour_externe",
  "treso.valider_budget",
  "treso.modifier_budget_categorie",
  "treso.valider_remboursement",
  "treso.valider_retour_exceptionnel",
  "treso.reorienter_demande",
];

/**
 * Actions d'historique (`HistoriqueEntry.action`) qui sont le résultat d'une action SIGNÉE : seules elles reçoivent une mention de
 * signature (ou « Antérieur à la signature » quand elles précèdent la mise en service). Les autres lignes d'historique n'en portent jamais.
 */
export const ACTIONS_HISTORIQUE_SIGNEES: ReadonlySet<string> = new Set([
  "validation_service",
  "renvoi_correction",
  "soumission_dg",
  "resoumission_dg",
  "validation_dg",
  "rejet_dg",
  "decision_circuit",
  "soumission_lignes_dg",
  "decision_ligne_dg",
  "validation_ligne",
  "rejet_ligne",
  "validation_ligne_dg",
  "refus_ligne_dg",
  "reorientation_service",
  "reprise_etape",
  "validation",
  "validation_complementaire",
  "rejet_demande",
  "rejet_reliquat",
  "validation_depense_directe",
  "cloture_totale",
  "cloture_partielle",
  "cloture_forcee",
  "validation_complete_dg",
  "rejet_validation_complete",
  "annulation_validation_complete",
  "resoumission_validation_complete",
  "reglement",
  "annulation_reglement",
  "reception_retour",
  "retour_nul_constate",
  "declaration_retour_assistant",
  "remboursement_retour_valide",
  "remboursement_retour_rejete",
  "retour_exceptionnel_post_cloture",
  "retour_exceptionnel_rejete",
  "retour_externe_rattache",
]);

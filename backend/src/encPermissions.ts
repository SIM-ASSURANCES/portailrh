/**
 * Permissions et rôles de départ du module Encaissements (voir docs/encaissements-conception.md §4).
 * Source unique pour le seed ; la migration `20260927100000_encaissements_module` insère exactement les mêmes
 * lignes (idempotente) pour les bases déjà seedées. Les rôles restent ensuite librement modifiables via /admin/roles.
 *
 * Aucune permission de VALIDATION d'un versement n'existe : qui valide un versement est une question en attente
 * auprès du client (ambiguïté 5, bloquante pour le commit Versement).
 */

export const ENC_MODULE_KEY = "encaissements";

export const ENC_PERMISSIONS = [
  { key: "enc.consulter", label: "Encaissements : consulter et exporter" },
  { key: "enc.importer_production", label: "Encaissements : importer le fichier de production" },
  { key: "enc.gerer_contrats", label: "Encaissements : créer et corriger les contrats (taux en saisie directe)" },
  { key: "enc.parametrer_taux", label: "Encaissements : paramétrer les taux par produit et par partenaire" },
  { key: "enc.annuler_contrat", label: "Encaissements : annuler un contrat (écran ou import)" },
  { key: "enc.saisir_versement", label: "Encaissements : saisir les versements" },
  { key: "enc.saisir_remise", label: "Encaissements : saisir les encaissements groupés" },
  { key: "enc.importer_encaissements", label: "Encaissements : importer des encaissements" },
  { key: "enc.saisir_suspens", label: "Encaissements : saisir et identifier les paiements en suspens" },
  { key: "enc.classer_suspens", label: "Encaissements : classer un suspens (non taxable, à rembourser)" },
  { key: "enc.regler_sortant", label: "Encaissements : saisir les règlements de taxes, commissions, honoraires et accessoires" },
  { key: "enc.rapprocher", label: "Encaissements : rapprocher les relevés banque et mobile money" },
  { key: "enc.corriger_versement_valide", label: "Encaissements : corriger un versement validé" },
  { key: "enc.annuler_reglement", label: "Encaissements : annuler un règlement" },
  { key: "enc.cloturer_mois", label: "Encaissements : clôturer un mois" },
  { key: "enc.decloturer_mois", label: "Encaissements : déclôturer un mois" },
  { key: "enc.deroger", label: "Encaissements : déroger à la liste de contrôle de clôture" },
] as const;

/**
 * Mise en service du module (remise à zéro + activation, conception §6) : même modèle que `systeme.reinitialiser`,
 * rattachée au module TECHNIQUE « systeme » (jamais une carte, jamais dans la matrice /admin/roles, jamais
 * modifiable depuis la console), attribuée au seul rôle DG, jamais héritée d'`estAdmin`.
 */
export const ENC_PERMISSION_MISE_EN_SERVICE = {
  key: "enc.mettre_en_service",
  label: "Encaissements : mettre le module en service (remise à zéro, usage unique)",
} as const;

export type EncPermissionKey = (typeof ENC_PERMISSIONS)[number]["key"];

/** Cinq rôles de départ = les cinq profils du cahier des charges (§2). Jeux de permissions POSITIVES uniquement. */
export const ENC_ROLES_DEPART: {
  name: string;
  description: string;
  permissions: EncPermissionKey[];
  compteTest: { fullName: string; email: string };
}[] = [
  {
    name: "Encaissements – Équipe technique",
    description: "Import de la production, contrats, paramétrage des taux, annulation de contrats",
    permissions: ["enc.consulter", "enc.importer_production", "enc.gerer_contrats", "enc.parametrer_taux", "enc.annuler_contrat"],
    compteTest: { fullName: "Enc Technique Test", email: "enc-technique@simassurances.test" },
  },
  {
    name: "Encaissements – Gestionnaire",
    description: "Appel d'une police, saisie des versements et des encaissements groupés, suspens",
    permissions: ["enc.consulter", "enc.saisir_versement", "enc.saisir_remise", "enc.importer_encaissements", "enc.saisir_suspens"],
    compteTest: { fullName: "Enc Gestionnaire Test", email: "enc-gestionnaire@simassurances.test" },
  },
  {
    name: "Encaissements – Finance",
    description: "Import de la production transmise, règlements sortants, rapprochement, suspens",
    permissions: [
      "enc.consulter",
      "enc.importer_production",
      "enc.saisir_suspens",
      "enc.classer_suspens",
      "enc.regler_sortant",
      "enc.rapprocher",
    ],
    compteTest: { fullName: "Enc Finance Test", email: "enc-finance@simassurances.test" },
  },
  {
    name: "Encaissements – Responsable",
    description: "Correction d'un versement validé, annulation d'un règlement, clôture et déclôture mensuelles",
    permissions: [
      "enc.consulter",
      "enc.corriger_versement_valide",
      "enc.annuler_reglement",
      "enc.cloturer_mois",
      "enc.decloturer_mois",
      "enc.deroger",
    ],
    compteTest: { fullName: "Enc Responsable Test", email: "enc-responsable@simassurances.test" },
  },
  {
    name: "Encaissements – Consultation",
    description: "Consultation et export, aucune modification",
    permissions: ["enc.consulter"],
    compteTest: { fullName: "Enc Consultation Test", email: "enc-consultation@simassurances.test" },
  },
];

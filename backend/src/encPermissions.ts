/**
 * Permissions et rôles de départ du module « Encaissements, taxes » (voir docs/encaissements-conception.md §4).
 * Source unique pour le seed ; la migration corrective `20260929000000_encaissements_permissions_v2` insère
 * exactement les mêmes lignes (idempotente) pour les bases déjà seedées avec les 17 permissions et 5 rôles du V1.
 * Les rôles restent ensuite librement modifiables via /admin/roles.
 *
 * 9 permissions validées le 2026-09-28 (conception §4, décision D1), 3 profils du cahier V2.6 §2 : Équipe technique,
 * Finance, Consultation. Les rôles « Encaissements – Gestionnaire » et « Encaissements – Responsable » du V1
 * disparaissent (la migration corrective les supprime, ou s'arrête si l'un d'eux porte encore un compte).
 *
 * Noms de rôle préfixés « Encaissements – » à dessein : un rôle « Finance » existe déjà pour la Trésorerie
 * (`seed.ts`, `roleFinance`) — jamais de collision de nom possible avec le préfixe.
 *
 * Aucune permission de VALIDATION d'un versement n'existe : la notion disparaît en V2 (CDC V2.6, aucun statut
 * « Brouillon »/« Validé »), ce qui clôt l'ambiguïté 5 du V1.
 */

export const ENC_MODULE_KEY = "encaissements";

export const ENC_PERMISSIONS = [
  { key: "enc.consulter", label: "Encaissements : consulter et exporter" },
  { key: "enc.importer_production", label: "Encaissements : importer le fichier de production" },
  { key: "enc.annuler_contrat", label: "Encaissements : annuler un contrat (écran ou import)" },
  { key: "enc.saisir_encaissement", label: "Encaissements : saisir un encaissement (fiche police, paiement pour plusieurs contrats)" },
  { key: "enc.confirmer_paiement", label: "Encaissements : confirmer les paiements du fichier technique, importer un relevé, les frais des opérateurs" },
  { key: "enc.corriger_encaissement", label: "Encaissements : corriger ou contre-passer un encaissement" },
  { key: "enc.gerer_non_identifie", label: "Encaissements : gérer l'argent non identifié (affecter, classer hors prime)" },
  { key: "enc.marquer_paye", label: "Encaissements : marquer payés (et décocher) taxes, commissions, honoraires et accessoires" },
  { key: "enc.parametrer", label: "Encaissements : paramétrer les honoraires, le partage des accessoires, les taux de contrôle et les branches" },
] as const;

/**
 * Mise en service du module (remise à zéro + activation, conception §6) : même modèle que `systeme.reinitialiser`,
 * rattachée au module TECHNIQUE « systeme » (jamais une carte, jamais dans la matrice /admin/roles, jamais
 * modifiable depuis la console), attribuée au seul rôle DG, jamais héritée d'`estAdmin`. Inchangée depuis le V1.
 */
export const ENC_PERMISSION_MISE_EN_SERVICE = {
  key: "enc.mettre_en_service",
  label: "Encaissements : mettre le module en service (remise à zéro, usage unique)",
} as const;

export type EncPermissionKey = (typeof ENC_PERMISSIONS)[number]["key"];

/**
 * Permissions autorisant le dépôt d'une pièce jointe par la route d'upload commune : toute permission d'écriture du
 * module (la simple consultation n'en dépose jamais). Le rattachement à une ressource précise reste revérifié par
 * l'action serveur qui crée l'`EncPieceJointe`, avec sa propre permission.
 */
export const ENC_PERMISSIONS_DEPOT_PIECE_JOINTE: readonly EncPermissionKey[] = ENC_PERMISSIONS.map((p) => p.key).filter(
  (k) => k !== "enc.consulter"
);

/**
 * Trois rôles de départ = les trois profils du cahier des charges V2.6 (§2). Jeux de permissions POSITIVES uniquement.
 *
 * - Équipe technique : produit et importe le fichier de production, annule un contrat, consulte les signalements —
 *   jamais de saisie, confirmation ni correction d'encaissement, ni de marquage « payé », ni de paramètres (CDC §2).
 * - Finance : tout le reste (D1) — y compris `enc.importer_production` (télécharge aussi les fichiers de production,
 *   D6) et la reprise initiale, qui exige `enc.importer_production` ET `enc.marquer_paye` (F1.5, réservée à la
 *   Finance) — mais jamais `enc.annuler_contrat` ni de modification des montants venant du fichier.
 * - Consultation : `enc.consulter` seule.
 */
export const ENC_ROLES_DEPART: {
  name: string;
  description: string;
  permissions: EncPermissionKey[];
  compteTest: { fullName: string; email: string };
}[] = [
  {
    name: "Encaissements – Équipe technique",
    description: "Produit et importe le fichier de production, annule un contrat, consulte les signalements",
    permissions: ["enc.consulter", "enc.importer_production", "enc.annuler_contrat"],
    compteTest: { fullName: "Enc Technique Test", email: "enc-technique@simassurances.test" },
  },
  {
    name: "Encaissements – Finance",
    description:
      "Importe la production, appelle une police, saisit/confirme/corrige/contre-passe un encaissement, gère l'argent " +
      "non identifié, marque payés taxes/commissions/honoraires/accessoires, paramètre le module, exporte",
    permissions: [
      "enc.consulter",
      "enc.importer_production",
      "enc.saisir_encaissement",
      "enc.confirmer_paiement",
      "enc.corriger_encaissement",
      "enc.gerer_non_identifie",
      "enc.marquer_paye",
      "enc.parametrer",
    ],
    compteTest: { fullName: "Enc Finance Test", email: "enc-finance@simassurances.test" },
  },
  {
    name: "Encaissements – Consultation",
    description: "Consultation et export, aucune modification",
    permissions: ["enc.consulter"],
    compteTest: { fullName: "Enc Consultation Test", email: "enc-consultation@simassurances.test" },
  },
];

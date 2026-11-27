/**
 * Permissions et rôles de départ du module « Gestion Compta » (docs/compta-conception.md §4).
 *
 * Source UNIQUE pour le seed et pour la migration du lot GC-1c (un test de synchronisation lira le SQL de cette migration,
 * comme `congesPermissions.test.ts`). Les rôles restent ensuite librement modifiables via /admin/roles.
 *
 * Module INDÉPENDANT (décision V1) : aucune permission d'un autre module n'est lue ni réutilisée, aucune n'est héritée
 * d'`estAdmin`, aucune n'est déduite d'une combinaison d'autres permissions (une permission par action).
 *
 * Le module `compta` n'est PAS ajouté à `MODULES_DELEGABLES` (frontend/src/app/(dashboard)/delegations) : ses permissions
 * ne sont donc délégables à personne. C'est ce qui rend « non délégables » toutes les permissions de décision ci-dessous,
 * sans rien modifier d'existant.
 *
 * Rôles de départ : PROVISOIRES tant que le RFCRH n'a pas répondu à Q5 (qui occupe chaque profil, quels cumuls). Un compte
 * qui cumule plusieurs profils reçoit un rôle combiné créé depuis /admin/roles (un seul rôle par utilisateur).
 *
 * Noms de rôle préfixés « Compta – » à dessein : jamais de collision avec les rôles des autres modules.
 */

export const CPT_MODULE_KEY = "compta";
export const CPT_MODULE_LABEL = "Gestion Compta";

export const CPT_PERMISSIONS = [
  { key: "cpt.consulter", label: "Gestion Compta : consulter et exporter" },
  { key: "cpt.consulter_remuneration", label: "Gestion Compta : voir la rémunération des partenaires" },
  { key: "cpt.importer_production", label: "Gestion Compta : importer le bordereau de production" },
  { key: "cpt.saisir_contrat", label: "Gestion Compta : saisir et corriger un contrat" },
  { key: "cpt.importer_releves", label: "Gestion Compta : importer les relevés d'encaissement" },
  { key: "cpt.identifier_encaissement", label: "Gestion Compta : identifier un encaissement (produit, client, partenaire, contrat)" },
  { key: "cpt.confirmer_rattachement", label: "Gestion Compta : confirmer un rattachement avec le reçu (étape 1)" },
  { key: "cpt.valider_rattachement", label: "Gestion Compta : valider ou rejeter un rattachement (étape 2)" },
  { key: "cpt.classer_pas_une_prime", label: "Gestion Compta : classer un encaissement « pas une prime » (motif écrit)" },
  { key: "cpt.declarer_tca", label: "Gestion Compta : déclarer la taxe du mois" },
  { key: "cpt.payer_tca", label: "Gestion Compta : enregistrer le paiement de la taxe et sa quittance" },
  { key: "cpt.regler_partenaire", label: "Gestion Compta : régler un partenaire" },
  { key: "cpt.compenser", label: "Gestion Compta : compenser entre natures de rémunération (opération explicite)" },
  { key: "cpt.gerer_conventions", label: "Gestion Compta : gérer les conventions des partenaires" },
  { key: "cpt.parametrer", label: "Gestion Compta : paramétrer les taux de taxe, formats d'import, comptes et seuils" },
  { key: "cpt.preparer_ecritures", label: "Gestion Compta : préparer les exports Odoo et la liste des éléments non comptabilisés" },
  { key: "cpt.relancer", label: "Gestion Compta : relancer et suivre les promesses de paiement" },
  { key: "cpt.cloturer_periode", label: "Gestion Compta : clôturer un mois" },
  { key: "cpt.trancher_litige", label: "Gestion Compta : trancher un litige (direction générale)" },
] as const;

/**
 * Mise en service du module (remise à zéro + activation, docs/compta-conception.md §8) : même modèle que
 * `systeme.reinitialiser`, rattachée au module TECHNIQUE « systeme » (jamais une carte, jamais dans la matrice
 * /admin/roles), attribuée au seul rôle DG par la migration du lot GC-1c, jamais héritée d'`estAdmin`.
 */
export const CPT_PERMISSION_MISE_EN_SERVICE = {
  key: "cpt.mettre_en_service",
  label: "Gestion Compta : mettre le module en service (remise à zéro, usage unique)",
} as const;

export type CptPermissionKey = (typeof CPT_PERMISSIONS)[number]["key"];

/**
 * Le DG est un SUPERVISEUR de Gestion Compta (réponse Q4, 2026-10-23) : il voit tout, tranche les litiges et met le module en
 * service, il ne saisit rien. Le rôle DG existant (celui qui porte la permission sœur ci-dessous, jamais repéré par son nom)
 * reçoit donc ces quatre permissions, par la migration et par le seed. Les rôles « Compta – Direction » restent disponibles pour
 * un superviseur qui n'est pas le DG.
 */
export const CPT_PERMISSION_SOEUR_DG = "systeme.reinitialiser";
export const CPT_PERMISSIONS_DG: readonly string[] = [
  "cpt.consulter",
  "cpt.consulter_remuneration",
  "cpt.trancher_litige",
  CPT_PERMISSION_MISE_EN_SERVICE.key,
];

/**
 * Permissions de DÉCISION : elles engagent la comptabilité ou une somme d'argent. Jamais déléguables (le module n'est pas
 * dans `MODULES_DELEGABLES`) ; signées au sens de la décision D5 (la confirmation du commercial, étape 1, ne l'est pas).
 */
export const CPT_PERMISSIONS_DECISION: readonly CptPermissionKey[] = [
  "cpt.valider_rattachement",
  "cpt.classer_pas_une_prime",
  "cpt.declarer_tca",
  "cpt.payer_tca",
  "cpt.regler_partenaire",
  "cpt.compenser",
  "cpt.cloturer_periode",
  "cpt.trancher_litige",
];

/**
 * Permissions autorisant le dépôt d'une pièce jointe par la route d'upload du module : toute permission d'écriture (la
 * consultation, y compris celle de la rémunération, n'en dépose jamais). Le rattachement à une ressource précise reste revérifié par l'action serveur
 * qui crée la `CptPieceJointe`, avec sa propre permission.
 */
export const CPT_PERMISSIONS_DEPOT_PIECE_JOINTE: readonly CptPermissionKey[] = CPT_PERMISSIONS.map((p) => p.key).filter(
  (k) => k !== "cpt.consulter" && k !== "cpt.consulter_remuneration"
);

export interface CptRoleDepart {
  name: string;
  description: string;
  permissions: CptPermissionKey[];
  compteTest: { fullName: string; email: string };
}

/**
 * Cinq rôles de départ = les cinq profils du cahier des charges SIM-XX-XX (§2). Jeux de permissions POSITIVES uniquement.
 *
 * - Production : saisit et importe les contrats, relance ; ne déclare jamais un contrat payé ni ne valide un rattachement.
 * - Commercial : identifie les encaissements et CONFIRME les rattachements avec le reçu (étape 1) ; ne saisit pas de contrat,
 *   ne valide pas.
 * - RFCRH : valide les rattachements (étape 2), déclare et paie la taxe, règle les partenaires, clôture, paramètre. Il ne porte
 *   volontairement PAS `cpt.confirmer_rattachement` : il ne peut pas sauter l'étape 1 (question Q3 bis).
 * - Comptable (stagiaire) : importe relevés et production, prépare les écritures ; ne valide ni ne paramètre.
 * - Direction : consulte tout et tranche les litiges ; ne saisit rien.
 *
 * `cpt.consulter_remuneration` (Q10, 2026-11-27) : lire commissions, honoraires, conventions et règlements des partenaires.
 * Réservée au RFCRH et à la Direction ; aucune permission d'écriture ne l'implique.
 */
export const CPT_ROLES_DEPART: readonly CptRoleDepart[] = [
  {
    name: "Compta – Production",
    description: "Service technique : saisit et importe les contrats, corrige les contrats signalés, relance",
    permissions: ["cpt.consulter", "cpt.importer_production", "cpt.saisir_contrat", "cpt.relancer"],
    compteTest: { fullName: "Compta Production Test", email: "compta-production@simassurances.test" },
  },
  {
    name: "Compta – Commercial",
    description: "Identifie les encaissements sans contrat, confirme les rattachements avec le reçu, relance les clients",
    permissions: ["cpt.consulter", "cpt.identifier_encaissement", "cpt.confirmer_rattachement", "cpt.relancer"],
    compteTest: { fullName: "Compta Commercial Test", email: "compta-commercial@simassurances.test" },
  },
  {
    name: "Compta – RFCRH",
    description:
      "Valide les rattachements, classe « pas une prime », déclare et paie la taxe, règle et compense les partenaires, " +
      "gère conventions et paramètres, prépare les écritures, clôture le mois",
    permissions: [
      "cpt.consulter",
      "cpt.consulter_remuneration",
      "cpt.identifier_encaissement",
      "cpt.valider_rattachement",
      "cpt.classer_pas_une_prime",
      "cpt.declarer_tca",
      "cpt.payer_tca",
      "cpt.regler_partenaire",
      "cpt.compenser",
      "cpt.gerer_conventions",
      "cpt.parametrer",
      "cpt.preparer_ecritures",
      "cpt.relancer",
      "cpt.cloturer_periode",
    ],
    compteTest: { fullName: "Compta RFCRH Test", email: "compta-rfcrh@simassurances.test" },
  },
  {
    name: "Compta – Comptable",
    description: "Stagiaire comptable : importe les relevés et la production, prépare les listes et les écritures Odoo",
    permissions: ["cpt.consulter", "cpt.importer_production", "cpt.importer_releves", "cpt.preparer_ecritures"],
    compteTest: { fullName: "Compta Comptable Test", email: "compta-comptable@simassurances.test" },
  },
  {
    name: "Compta – Direction",
    description: "Direction générale : consulte tous les tableaux de bord, tranche les litiges, ne saisit rien",
    permissions: ["cpt.consulter", "cpt.consulter_remuneration", "cpt.trancher_litige"],
    compteTest: { fullName: "Compta Direction Test", email: "compta-direction@simassurances.test" },
  },
];

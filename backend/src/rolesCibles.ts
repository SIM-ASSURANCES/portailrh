/**
 * ÉTAT CIBLE des rôles et des permissions (lot R) : source UNIQUE du seed, du document `docs/roles-et-permissions.md`
 * (généré par `prisma/generer-doc-roles.ts`, tenu à jour par un test) et du script de comparaison
 * `prisma/lister-roles-permissions.ts`.
 *
 * La production n'est jamais re-seedée : ce tableau décrit ce que les rôles DOIVENT porter, que la base soit neuve (seed)
 * ou migrée (migrations). Vérifié le 2026-10-22 sur une base simulant la production (seed du 2026-09-17 + toutes les
 * migrations) : les 76 attributions rôle-permission coïncident avec ce tableau (voir `docs/roles-et-permissions.md`, § Écarts).
 *
 * Aucune règle métier ici : ces listes sont celles du seed, déplacées telles quelles (même ordre, mêmes clés).
 */
import { ENC_MODULE_KEY, ENC_PERMISSIONS, ENC_PERMISSION_MISE_EN_SERVICE, ENC_ROLES_DEPART } from "./encPermissions";
import { MODULE_CONGES_KEY, MODULE_CONGES_LABEL, PERMISSIONS_CONGES, permissionsCongePourCles } from "./congesPermissions";

export type CleModule = "tresorerie" | "pointage" | "feedback" | "systeme" | typeof ENC_MODULE_KEY | typeof MODULE_CONGES_KEY;

export interface ModuleCatalogue {
  key: CleModule;
  label: string;
}

/** Les 6 modules, avec le libellé que le seed leur donne (affiché dans /admin/roles, sauf « Système » qui y est masqué). */
export const MODULES_CATALOGUE: readonly ModuleCatalogue[] = [
  { key: "tresorerie", label: "Gestion des demandes et trésorerie" },
  { key: "pointage", label: "Pointage RH" },
  { key: "feedback", label: "FeedbackApp" },
  { key: "systeme", label: "Système" },
  { key: ENC_MODULE_KEY, label: "Encaissements, taxes et commissions" },
  { key: MODULE_CONGES_KEY, label: MODULE_CONGES_LABEL },
];

export interface PermissionCatalogue {
  key: string;
  /** Libellé enregistré en base et affiché dans /admin/roles. */
  label: string;
  moduleKey: CleModule;
}

const t = (key: string, label: string): PermissionCatalogue => ({ key, label, moduleKey: "tresorerie" });
const p = (key: string, label: string): PermissionCatalogue => ({ key, label, moduleKey: "pointage" });

/** Catalogue complet (ordre du seed). */
export const PERMISSIONS_CATALOGUE: readonly PermissionCatalogue[] = [
  t("treso.creer_demande", "Créer une demande"),
  t("treso.categoriser_demande", "Catégoriser une demande"),
  t("treso.valider_demande", "Valider une demande"),
  t("treso.effectuer_reglement", "Effectuer un règlement"),
  t("treso.declarer_retour", "Déclarer un retour de caisse"),
  t("treso.receptionner_retour", "Réceptionner un retour de caisse"),
  t("treso.cloturer_demande", "Clôturer une demande"),
  t("treso.approuver_validation_complete", "Approuver la validation complète (verrou de clôture)"),
  t("treso.saisir_depense_directe", "Saisir une dépense directe"),
  t("treso.alimenter_caisse", "Enregistrer une alimentation de caisse"),
  t("treso.corriger_solde_ouverture", "Définir/corriger le solde d'ouverture de caisse"),
  t("treso.voir_dashboard_finance", "Voir le dashboard finance"),
  t("treso.voir_reporting", "Voir le reporting"),
  t("treso.gerer_categories", "Gérer les catégories et objets d'achat (créer/supprimer)"),
  t("treso.decider_finance", "Décider à l'étape Finance (valider ou rejeter les lignes)"),
  t("treso.soumettre_dg", "Soumettre ou resoumettre une demande au DG"),
  t("treso.annuler_reglement", "Annuler un règlement confirmé"),
  t("treso.ajuster_retour", "Ajuster le total déclaré d'un retour de caisse"),
  t("treso.valider_remboursement", "Valider ou rejeter un remboursement de retour"),
  t("treso.valider_retour_exceptionnel", "Valider ou rejeter un retour exceptionnel post-clôture"),
  t("treso.creer_retour_externe", "Enregistrer un retour externe (hors demande)"),
  t("treso.modifier_budget_categorie", "Modifier le budget d'une catégorie"),
  t("treso.deleguer_acces", "Déléguer des accès"),
  t("treso.decider_dg", "Décider à l'étape DG (valider ou rejeter une demande soumise)"),
  t("treso.reorienter_demande", "Réorienter l'étape Service d'une demande vers un autre responsable"),
  t("treso.valider_budget", "Valider ou refuser un paramétrage de budget (DG)"),
  t("treso.modifier_description", "Modifier la description d'une demande et le libellé de ses lignes"),
  p("pointage.pointer", "Pointer (arrivée / départ)"),
  p("pointage.consulter_historique", "Consulter son propre historique de pointage"),
  p("pointage.consulter_tous", "Consulter les pointages de tous les employés"),
  p("pointage.pointage_exceptionnel", "Pointer à la place d'un collaborateur"),
  p("pointage.corriger_pointage", "Corriger un pointage"),
  p("pointage.gerer_horaires", "Paramétrer les horaires de référence"),
  p("pointage.voir_dashboard_rh", "Voir le dashboard RH"),
  p("pointage.voir_reporting", "Voir le reporting RH"),
  p("pointage.reinitialiser", "Réinitialiser les données du Pointage avant sa mise en service"),
  { key: "feedback.moderer", label: "Modérer les messages FeedbackApp", moduleKey: "feedback" },
  {
    key: "systeme.reinitialiser",
    label: "Réinitialiser les données de test avant mise en production (usage unique)",
    moduleKey: "systeme",
  },
  ...ENC_PERMISSIONS.map((e): PermissionCatalogue => ({ key: e.key, label: e.label, moduleKey: ENC_MODULE_KEY })),
  { ...ENC_PERMISSION_MISE_EN_SERVICE, moduleKey: "systeme" },
  ...PERMISSIONS_CONGES.map((c): PermissionCatalogue => ({ key: c.key, label: c.label, moduleKey: MODULE_CONGES_KEY })),
];

export interface RoleCible {
  name: string;
  description: string;
  estAdmin: boolean;
  peutEtreBeneficiaireDelegation: boolean;
  peutRecevoirFeedback: boolean;
  /** Permissions cibles, Congés compris (calculées d'après les permissions sœurs, comme la migration). */
  permissions: string[];
}

interface RoleBase extends Omit<RoleCible, "permissions"> {
  /** Permissions « de base » : sans celles du module Congés, déduites ensuite par permission sœur. */
  permissionsBase: string[];
}

const ROLES_BASE: RoleBase[] = [
  {
    name: "Collaborateur",
    description: "Collaborateur pouvant créer des demandes",
    estAdmin: false,
    peutEtreBeneficiaireDelegation: true,
    peutRecevoirFeedback: true,
    permissionsBase: ["treso.creer_demande", "treso.declarer_retour", "pointage.pointer", "pointage.consulter_historique"],
  },
  {
    name: "Finance",
    description: "Équipe finance / trésorerie : décide (valide, rejette, clôture)",
    estAdmin: false,
    peutEtreBeneficiaireDelegation: false,
    peutRecevoirFeedback: true,
    permissionsBase: [
      // Décision 3 du circuit (2026-10-07) : la Finance crée aussi des demandes (cas b : le DG les décide), et déclare
      // le retour de caisse des siennes (un autre compte le réceptionne).
      "treso.creer_demande",
      "treso.declarer_retour",
      "treso.categoriser_demande",
      "treso.valider_demande",
      "treso.cloturer_demande",
      "treso.alimenter_caisse",
      "treso.corriger_solde_ouverture",
      "treso.voir_dashboard_finance",
      "treso.voir_reporting",
      "treso.saisir_depense_directe",
      "treso.gerer_categories",
      // Actions autrefois déduites de « valider_demande sans approuver_validation_complete » (2026-10-06).
      "treso.decider_finance",
      "treso.soumettre_dg",
      "treso.annuler_reglement",
      "treso.ajuster_retour",
      "treso.valider_remboursement",
      "treso.valider_retour_exceptionnel",
      "treso.creer_retour_externe",
      "treso.modifier_budget_categorie",
      "treso.deleguer_acces",
      "treso.modifier_description",
      "treso.reorienter_demande",
    ],
  },
  {
    name: "DG",
    description: "Direction générale",
    estAdmin: false,
    peutEtreBeneficiaireDelegation: false,
    peutRecevoirFeedback: true,
    permissionsBase: [
      // Décision 10 (2026-10-08) : plus de "treso.valider_demande" — le DG décide à l'étape DG (decider_dg) et approuve
      // la clôture ; ses consultations passent par "treso.voir_dashboard_finance".
      "treso.voir_dashboard_finance",
      "treso.voir_reporting",
      "treso.approuver_validation_complete",
      "treso.decider_dg",
      "treso.valider_budget",
      "treso.creer_demande",
      "treso.declarer_retour",
      "pointage.consulter_tous",
      "pointage.voir_dashboard_rh",
      "pointage.voir_reporting",
      "feedback.moderer",
      // Réinitialisation à usage unique : DG SEUL (jamais Admin, jamais héritée d'estAdmin).
      "systeme.reinitialiser",
      // Mise en service du module Encaissements : même modèle, DG seul.
      ENC_PERMISSION_MISE_EN_SERVICE.key,
    ],
  },
  {
    name: "Admin",
    description: "Administrateur du portail",
    estAdmin: true,
    peutEtreBeneficiaireDelegation: false,
    // Compte technique, pas un employé à évaluer : jamais proposable comme destinataire de feedback.
    peutRecevoirFeedback: false,
    // EXCEPTIONS DÉLIBÉRÉES à l'invariant « le rôle Admin n'a aucune RolePermission » : feedback.moderer (décision du
    // 17/09/2026) et pointage.reinitialiser (14/10/2026). Ne pas en ajouter d'autres sans décision explicite.
    permissionsBase: ["feedback.moderer", "pointage.reinitialiser"],
  },
  {
    name: "RH",
    description: "Gère le pointage, les retards, absences et reportings RH",
    estAdmin: false,
    peutEtreBeneficiaireDelegation: false,
    peutRecevoirFeedback: true,
    permissionsBase: [
      "pointage.pointer",
      "pointage.consulter_historique",
      "pointage.consulter_tous",
      "pointage.pointage_exceptionnel",
      "pointage.corriger_pointage",
      "pointage.gerer_horaires",
      "pointage.voir_dashboard_rh",
      "pointage.voir_reporting",
      "feedback.moderer",
    ],
  },
  {
    name: "Assistant Finance",
    description: "Exécute les règlements/décaissements et réceptionne les retours de caisse (séparation des tâches)",
    estAdmin: false,
    // Exception délibérée dès la création du rôle (voir « Délégation individuelle de permissions »).
    peutEtreBeneficiaireDelegation: true,
    peutRecevoirFeedback: true,
    permissionsBase: [
      "treso.effectuer_reglement",
      "treso.receptionner_retour",
      "treso.modifier_description",
      "treso.creer_demande",
      "treso.declarer_retour",
    ],
  },
  ...ENC_ROLES_DEPART.map(
    (r): RoleBase => ({
      name: r.name,
      description: r.description,
      estAdmin: false,
      peutEtreBeneficiaireDelegation: false,
      peutRecevoirFeedback: true,
      permissionsBase: [...r.permissions],
    })
  ),
];

/** Rôles cibles (6 rôles du portail puis les 3 rôles Encaissements), Congés compris. */
export const ROLES_CIBLES: readonly RoleCible[] = ROLES_BASE.map(({ permissionsBase, ...role }) => ({
  ...role,
  // Congés : même règle que la migration (permission sœur), jamais un nom de rôle ; un rôle estAdmin ne reçoit que le droit de demande.
  permissions: [...permissionsBase, ...permissionsCongePourCles(permissionsBase, role.estAdmin)],
}));

export const NOMS_ROLES_PORTAIL = ["Admin", "DG", "Finance", "Assistant Finance", "RH", "Collaborateur"] as const;

/** Permissions du module technique « Système » (ou rattachées à lui) : jamais cochables depuis /admin/roles. */
export function permissionsNonCochables(): string[] {
  return PERMISSIONS_CATALOGUE.filter((c) => c.moduleKey === "systeme").map((c) => c.key);
}

export function roleCible(nom: string): RoleCible {
  const r = ROLES_CIBLES.find((x) => x.name === nom);
  if (!r) throw new Error(`Rôle cible inconnu : ${nom}`);
  return r;
}

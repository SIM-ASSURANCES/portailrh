// Congés et permissions d'absence : modules, permissions et données de départ (source unique).
//
// Repris à l'identique par le seed ET par la migration 20261021090000_conges_permissions_absence (un test de
// synchronisation, congesDefauts.test.ts, lit le SQL de la migration). La production n'est jamais re-seedée : tout ce
// qui doit exister là-bas passe par la migration, qui attribue les permissions PAR PERMISSION « SŒUR » (les rôles qui
// portent déjà la permission sœur reçoivent la nouvelle), jamais par un nom de rôle.

export const MODULE_CONGES_KEY = "conges";
export const MODULE_CONGES_LABEL = "Congés";
export const MODULE_ABSENCES_KEY = "absences";
export const MODULE_ABSENCES_LABEL = "Permissions d'absence";

/** Permission sœur : la nouvelle permission est donnée aux rôles qui portent AU MOINS UNE des sœurs. */
export interface PermissionAbsence {
  key: string;
  label: string;
  module: typeof MODULE_CONGES_KEY | typeof MODULE_ABSENCES_KEY;
  soeurs: readonly string[];
}

// Tout le personnel : un rôle qui pointe, crée des demandes de dépense ou décide comme DG peut demander un congé.
const TOUT_LE_PERSONNEL = ["pointage.pointer", "treso.creer_demande", "treso.decider_dg"] as const;
const RH = ["pointage.corriger_pointage"] as const;
const RH_ET_DG_LECTURE = ["pointage.consulter_tous"] as const;
const TABLEAUX_DE_BORD = ["pointage.voir_dashboard_rh", "treso.decider_dg"] as const;
const REPORTING = ["pointage.voir_reporting", "treso.decider_dg"] as const;

export const PERMISSIONS_CONGES: readonly PermissionAbsence[] = [
  { key: "conges.soumettre", label: "Demander un congé, consulter ses congés et son solde", module: "conges", soeurs: TOUT_LE_PERSONNEL },
  { key: "conges.valider_rh", label: "Valider définitivement un congé (étape RH, congé d'office)", module: "conges", soeurs: RH },
  { key: "conges.annuler", label: "Annuler un congé validé", module: "conges", soeurs: RH },
  { key: "conges.parametrer_types", label: "Paramétrer les types de congé", module: "conges", soeurs: RH },
  { key: "conges.gerer_soldes", label: "Gérer les soldes de congé et les dates d'embauche", module: "conges", soeurs: RH },
  { key: "conges.consulter_tous", label: "Consulter les congés de tous les employés", module: "conges", soeurs: RH_ET_DG_LECTURE },
  { key: "conges.voir_dashboard", label: "Voir le tableau de bord des congés", module: "conges", soeurs: TABLEAUX_DE_BORD },
  { key: "conges.voir_reporting", label: "Voir le reporting des congés", module: "conges", soeurs: REPORTING },
];

export const PERMISSIONS_ABSENCES: readonly PermissionAbsence[] = [
  { key: "absences.soumettre", label: "Demander une permission d'absence, consulter les siennes", module: "absences", soeurs: TOUT_LE_PERSONNEL },
  { key: "absences.valider_rh", label: "Valider une permission d'absence (étape RH)", module: "absences", soeurs: RH },
  { key: "absences.annuler", label: "Annuler une permission d'absence approuvée", module: "absences", soeurs: RH },
  { key: "absences.parametrer", label: "Paramétrer les types et plafonds de permission", module: "absences", soeurs: RH },
  { key: "absences.consulter_tous", label: "Consulter les permissions d'absence de tous les employés", module: "absences", soeurs: RH_ET_DG_LECTURE },
  { key: "absences.voir_dashboard", label: "Voir le tableau de bord des permissions d'absence", module: "absences", soeurs: TABLEAUX_DE_BORD },
  { key: "absences.voir_reporting", label: "Voir le reporting des permissions d'absence", module: "absences", soeurs: REPORTING },
];

export const PERMISSIONS_CONGES_ET_ABSENCES: readonly PermissionAbsence[] = [...PERMISSIONS_CONGES, ...PERMISSIONS_ABSENCES];

/**
 * Permissions d'ÉTAPE RH : le droit de décider se lit sur le RÔLE (jamais par délégation), comme les justifications de
 * retard. Elles s'ajoutent à `PERMISSIONS_DECISION_NON_DELEGABLES` (circuitDemande.ts).
 */
export const PERMISSIONS_ETAPE_RH_ABSENCE = ["conges.valider_rh", "absences.valider_rh"] as const;

export interface TypeCongeDefaut {
  code: string;
  label: string;
  categorie: "CONGE_STANDARD" | "PERMISSION_EXCEPTIONNELLE";
  nbJoursDefaut: number;
  decompteType: "CALENDAIRE" | "OUVRABLE";
  justificatifObligatoire: boolean;
  nonDeductibleSolde: boolean;
  ancienneteMinimumMois: number;
}

const ARTICLE_13 = {
  categorie: "PERMISSION_EXCEPTIONNELLE",
  decompteType: "OUVRABLE",
  justificatifObligatoire: true,
  nonDeductibleSolde: true,
  ancienneteMinimumMois: 6,
} as const;

export const TYPES_CONGE_DEFAUT: readonly TypeCongeDefaut[] = [
  { code: "ANNUEL", label: "Congé annuel", categorie: "CONGE_STANDARD", nbJoursDefaut: 30, decompteType: "OUVRABLE", justificatifObligatoire: false, nonDeductibleSolde: false, ancienneteMinimumMois: 0 },
  // Maladie : non déductible (la v2 la déclarait déductible avec une dotation de 0 jour, donc impossible à demander).
  // Réglage PROVISOIRE à confirmer avec la RH (D6).
  { code: "MALADIE", label: "Congé maladie", categorie: "CONGE_STANDARD", nbJoursDefaut: 0, decompteType: "CALENDAIRE", justificatifObligatoire: true, nonDeductibleSolde: true, ancienneteMinimumMois: 0 },
  { code: "MATERNITE", label: "Congé maternité", categorie: "CONGE_STANDARD", nbJoursDefaut: 98, decompteType: "CALENDAIRE", justificatifObligatoire: true, nonDeductibleSolde: false, ancienneteMinimumMois: 0 },
  { code: "SANS_SOLDE", label: "Congé sans solde", categorie: "CONGE_STANDARD", nbJoursDefaut: 0, decompteType: "CALENDAIRE", justificatifObligatoire: false, nonDeductibleSolde: true, ancienneteMinimumMois: 0 },
  // Permissions exceptionnelles — article 13 (non déductibles, 6 mois d'ancienneté, justificatif obligatoire).
  { code: "MARIAGE_SALARIE", label: "Mariage du salarié", nbJoursDefaut: 4, ...ARTICLE_13 },
  { code: "MARIAGE_FAMILLE", label: "Mariage d'un enfant, d'un frère ou d'une sœur", nbJoursDefaut: 2, ...ARTICLE_13 },
  { code: "DECES_CONJOINT", label: "Décès du conjoint", nbJoursDefaut: 5, ...ARTICLE_13 },
  { code: "DECES_ENFANT_PARENT", label: "Décès d'un enfant, du père ou de la mère", nbJoursDefaut: 5, ...ARTICLE_13 },
  { code: "DECES_FRERE_SOEUR", label: "Décès d'un frère ou d'une sœur", nbJoursDefaut: 2, ...ARTICLE_13 },
  { code: "DECES_BEAU_PARENT", label: "Décès du beau-père ou de la belle-mère", nbJoursDefaut: 2, ...ARTICLE_13 },
  { code: "NAISSANCE", label: "Naissance d'un enfant", nbJoursDefaut: 2, ...ARTICLE_13 },
  { code: "COMMUNION_BAPTEME", label: "Première communion ou baptême d'un enfant", nbJoursDefaut: 1, ...ARTICLE_13 },
  { code: "DEMENAGEMENT", label: "Déménagement", nbJoursDefaut: 1, ...ARTICLE_13 },
];

export interface TypePermissionDefaut {
  label: string;
  dureeMaxHeures: number;
  plafondMensuel: number;
  justificatifRecommande: boolean;
}

export const TYPES_PERMISSION_DEFAUT: readonly TypePermissionDefaut[] = [
  { label: "Rendez-vous médical", dureeMaxHeures: 3, plafondMensuel: 2, justificatifRecommande: true },
  { label: "Raison familiale urgente", dureeMaxHeures: 4, plafondMensuel: 1, justificatifRecommande: false },
  { label: "Démarche administrative", dureeMaxHeures: 3, plafondMensuel: 1, justificatifRecommande: false },
  { label: "Autre", dureeMaxHeures: 4, plafondMensuel: 2, justificatifRecommande: false },
];

/**
 * Permissions Congés / Permissions d'absence qu'un rôle reçoit, d'après les permissions qu'il porte déjà : la règle
 * de la migration (permission « sœur »), appliquée par le seed pour qu'une base neuve et une base migrée coïncident.
 */
export function permissionsAbsencePourCles(clesDuRole: Iterable<string>): string[] {
  const portees = new Set(clesDuRole);
  return PERMISSIONS_CONGES_ET_ABSENCES.filter((p) => p.soeurs.some((s) => portees.has(s))).map((p) => p.key);
}

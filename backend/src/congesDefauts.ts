// Congés : permissions et données de départ (source unique).
//
// Repris à l'identique par le seed ET par la migration 20261021090000_conges_permissions_absence (un test de
// synchronisation, congesDefauts.test.ts, lit le SQL de la migration). La production n'est jamais re-seedée : tout ce
// qui doit exister là-bas passe par la migration, qui attribue les permissions PAR PERMISSION « SŒUR » (les rôles qui
// portent déjà la permission sœur reçoivent la nouvelle), jamais par un nom de rôle.

export const MODULE_CONGES_KEY = "conges";
export const MODULE_CONGES_LABEL = "Congés";

/** Permission sœur : la nouvelle permission est donnée aux rôles qui portent AU MOINS UNE des sœurs. */
export interface PermissionConge {
  key: string;
  label: string;
  module: typeof MODULE_CONGES_KEY;
  soeurs: readonly string[];
}

// Tout le personnel : un rôle qui pointe, crée des demandes de dépense ou décide comme DG peut demander un congé.
const TOUT_LE_PERSONNEL = ["pointage.pointer", "treso.creer_demande", "treso.decider_dg"] as const;
const RH = ["pointage.corriger_pointage"] as const;
const RH_ET_DG_LECTURE = ["pointage.consulter_tous"] as const;

export const PERMISSIONS_CONGES: readonly PermissionConge[] = [
  { key: "conges.soumettre", label: "Demander un congé, consulter ses congés et son solde", module: "conges", soeurs: TOUT_LE_PERSONNEL },
  { key: "conges.valider_rh", label: "Valider définitivement un congé (étape RH, congé d'office)", module: "conges", soeurs: RH },
  { key: "conges.annuler", label: "Annuler un congé validé", module: "conges", soeurs: RH },
  { key: "conges.parametrer_types", label: "Paramétrer les types de congé", module: "conges", soeurs: RH },
  { key: "conges.gerer_soldes", label: "Gérer les soldes de congé et les dates d'embauche", module: "conges", soeurs: RH },
  { key: "conges.consulter_tous", label: "Consulter les congés de tous les employés", module: "conges", soeurs: RH_ET_DG_LECTURE },
];

/**
 * Permissions d'ÉTAPE RH : le droit de décider se lit sur le RÔLE (jamais par délégation), comme les justifications de
 * retard. Elles s'ajoutent à `PERMISSIONS_DECISION_NON_DELEGABLES` (circuitDemande.ts).
 */
export const PERMISSIONS_ETAPE_RH_ABSENCE = ["conges.valider_rh"] as const;

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
  // Art. 12 du règlement : le congé annuel s'ouvre après 12 mois de service (consignes du 2026-10-16). 30 jours = valeur de départ
  // PROVISOIRE, paramétrable par la RH (C1).
  { code: "ANNUEL", label: "Congé annuel", categorie: "CONGE_STANDARD", nbJoursDefaut: 30, decompteType: "OUVRABLE", justificatifObligatoire: false, nonDeductibleSolde: false, ancienneteMinimumMois: 12 },
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

/**
 * Permissions Congés qu'un rôle reçoit, d'après les permissions qu'il porte déjà : la règle
 * de la migration (permission « sœur »), appliquée par le seed pour qu'une base neuve et une base migrée coïncident.
 */
export function permissionsCongePourCles(clesDuRole: Iterable<string>): string[] {
  const portees = new Set(clesDuRole);
  return PERMISSIONS_CONGES.filter((p) => p.soeurs.some((s) => portees.has(s))).map((p) => p.key);
}

// Congés : module et permissions (source unique).
//
// Repris à l'identique par le seed ET par la migration 20261028090000_conges_permissions_absence (un test de
// synchronisation, congesPermissions.test.ts, lit le SQL de la migration). La production n'est jamais re-seedée : tout ce
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
const RH_ET_DG_LECTURE = ["pointage.corriger_pointage", "pointage.consulter_tous", "treso.decider_dg"] as const;

export const PERMISSIONS_CONGES: readonly PermissionConge[] = [
  { key: "conges.soumettre", label: "Demander un congé, consulter les siens", module: "conges", soeurs: TOUT_LE_PERSONNEL },
  { key: "conges.valider_rh", label: "Valider un congé (étape RH), enregistrer un congé pour un salarié", module: "conges", soeurs: RH },
  { key: "conges.annuler", label: "Annuler un congé, même commencé", module: "conges", soeurs: RH },
  { key: "conges.consulter_tous", label: "Consulter les congés de tous les employés et les exporter", module: "conges", soeurs: RH_ET_DG_LECTURE },
];

/** Droits de DEMANDE : les seuls qu'un rôle `estAdmin` reçoit (décider et consulter tout lui restent à cocher à la main). */
export const PERMISSIONS_CONGES_DEMANDE: readonly string[] = ["conges.soumettre"];

/**
 * Permissions Congés qu'un rôle reçoit, d'après les permissions qu'il porte déjà : la règle de la migration (permission
 * « sœur »), appliquée par le seed pour qu'une base neuve et une base migrée coïncident. `estAdmin` : droits de demande seulement.
 */
export function permissionsCongePourCles(clesDuRole: Iterable<string>, estAdmin = false): string[] {
  const portees = new Set(clesDuRole);
  return PERMISSIONS_CONGES.filter((p) => p.soeurs.some((s) => portees.has(s)))
    .map((p) => p.key)
    .filter((k) => !estAdmin || PERMISSIONS_CONGES_DEMANDE.includes(k));
}

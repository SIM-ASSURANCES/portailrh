/**
 * Comparaison de l'état RÉEL des rôles d'une base avec l'état cible (`rolesCibles.ts`) et rendu de
 * `roles-et-permissions-base.md` (lot R). Pur : la lecture de la base est faite par `prisma/lister-roles-permissions.ts`.
 */
import { PERMISSIONS_CATALOGUE, ROLES_CIBLES, type PermissionCatalogue, type RoleCible } from "./rolesCibles";
import { COUPLES_INTERDITS, PERMISSIONS_DG_SEUL } from "./rolesDocumentation";

export interface RoleLu {
  name: string;
  description: string | null;
  estAdmin: boolean;
  peutEtreBeneficiaireDelegation: boolean;
  peutRecevoirFeedback: boolean;
  /** Comptes ACTIFS qui portent ce rôle (nombre seulement : aucune donnée personnelle dans le fichier). */
  nbComptesActifs: number;
  permissions: string[];
}

export interface PermissionLue {
  key: string;
  label: string;
  moduleKey: string;
}

export interface EcartRole {
  role: string;
  /** Prévues par le document mais absentes du rôle en base. */
  manquantes: string[];
  /** Portées par le rôle en base mais absentes du document. */
  enTrop: string[];
  /** Réglages du rôle (Administrateur, délégation, feedback) qui diffèrent. */
  reglages: string[];
}

export interface Comparaison {
  /** Permissions du catalogue absentes de la base : leur migration n'est pas appliquée. */
  permissionsAbsentes: string[];
  /** Permissions de la base inconnues du catalogue. */
  permissionsInconnues: string[];
  /** Rôles du document absents de la base. */
  rolesAbsents: string[];
  /** Rôles de la base absents du document (rôles créés à la main : à vérifier, non comparés). */
  rolesInconnus: string[];
  ecarts: EcartRole[];
  /** Couples interdits portés, et permissions « DG seul » portées par un autre rôle. */
  alertes: string[];
}

export function comparerAvecCible(
  roles: readonly RoleLu[],
  permissions: readonly PermissionLue[],
  cibles: readonly RoleCible[] = ROLES_CIBLES,
  catalogue: readonly PermissionCatalogue[] = PERMISSIONS_CATALOGUE
): Comparaison {
  const clesBase = new Set(permissions.map((p) => p.key));
  const clesCatalogue = new Set(catalogue.map((p) => p.key));
  const parNom = new Map(roles.map((r) => [r.name, r]));
  const ecarts: EcartRole[] = [];
  for (const cible of cibles) {
    const lu = parNom.get(cible.name);
    if (!lu) continue;
    const portees = new Set(lu.permissions);
    const voulues = new Set(cible.permissions);
    const manquantes = cible.permissions.filter((k) => !portees.has(k));
    const enTrop = lu.permissions.filter((k) => !voulues.has(k)).sort();
    const reglages: string[] = [];
    if (lu.estAdmin !== cible.estAdmin) reglages.push(`Administrateur : base ${lu.estAdmin ? "oui" : "non"}, document ${cible.estAdmin ? "oui" : "non"}`);
    if (lu.peutEtreBeneficiaireDelegation !== cible.peutEtreBeneficiaireDelegation)
      reglages.push(`Bénéficiaire de délégation : base ${lu.peutEtreBeneficiaireDelegation ? "oui" : "non"}, document ${cible.peutEtreBeneficiaireDelegation ? "oui" : "non"}`);
    if (lu.peutRecevoirFeedback !== cible.peutRecevoirFeedback)
      reglages.push(`Peut recevoir un feedback : base ${lu.peutRecevoirFeedback ? "oui" : "non"}, document ${cible.peutRecevoirFeedback ? "oui" : "non"}`);
    if (manquantes.length || enTrop.length || reglages.length) ecarts.push({ role: cible.name, manquantes, enTrop, reglages });
  }

  const alertes: string[] = [];
  for (const c of COUPLES_INTERDITS) {
    const lu = parNom.get(c.roles);
    if (lu?.permissions.includes(c.cle)) alertes.push(`Le rôle « ${c.roles} » porte \`${c.cle}\` — ${c.raison}.`);
  }
  for (const r of roles) {
    for (const reserve of PERMISSIONS_DG_SEUL) {
      if (r.name !== "DG" && r.permissions.includes(reserve.cle)) {
        alertes.push(`Le rôle « ${r.name} » porte \`${reserve.cle}\`, réservée au DG — ${reserve.raison}.`);
      }
    }
  }

  return {
    permissionsAbsentes: catalogue.map((p) => p.key).filter((k) => !clesBase.has(k)),
    permissionsInconnues: permissions.map((p) => p.key).filter((k) => !clesCatalogue.has(k)).sort(),
    rolesAbsents: cibles.map((c) => c.name).filter((n) => !parNom.has(n)),
    rolesInconnus: roles.map((r) => r.name).filter((n) => !cibles.some((c) => c.name === n)).sort(),
    ecarts,
    alertes,
  };
}

export function comparaisonVide(c: Comparaison): boolean {
  return (
    c.permissionsAbsentes.length === 0 &&
    c.permissionsInconnues.length === 0 &&
    c.rolesAbsents.length === 0 &&
    c.ecarts.length === 0 &&
    c.alertes.length === 0
  );
}

const codes = (l: readonly string[]) => l.map((k) => `\`${k}\``).join(", ");

/** Contenu de `roles-et-permissions-base.md` : liste réelle des rôles et de leurs permissions, puis écarts avec le document. */
export function genererMarkdownBase(
  roles: readonly RoleLu[],
  permissions: readonly PermissionLue[],
  comparaison: Comparaison,
  genereLe: string
): string {
  const libelle = new Map(permissions.map((p) => [p.key, p]));
  const o: string[] = [];
  o.push("# Rôles et permissions — état RÉEL de la base");
  o.push("");
  o.push(`Généré le ${genereLe} par \`prisma/lister-roles-permissions.ts\` (lecture seule). À comparer à \`docs/roles-et-permissions.md\`.`);
  o.push("");
  o.push(`${roles.length} rôle(s), ${permissions.length} permission(s) en base.`);
  o.push("");

  o.push("## Écarts avec docs/roles-et-permissions.md");
  o.push("");
  if (comparaisonVide(comparaison)) {
    o.push("Aucun écart : chaque rôle porte exactement ce que le document prévoit.");
  } else {
    if (comparaison.alertes.length) {
      o.push("**À CORRIGER**");
      o.push("");
      for (const a of comparaison.alertes) o.push(`- ${a}`);
      o.push("");
    }
    if (comparaison.permissionsAbsentes.length) {
      o.push(`**Permissions absentes de la base** (migration non appliquée : lancer \`prisma migrate deploy\`) : ${codes(comparaison.permissionsAbsentes)}.`);
      o.push("");
    }
    if (comparaison.rolesAbsents.length) {
      o.push(`**Rôles du document absents de la base** : ${comparaison.rolesAbsents.join(", ")}.`);
      o.push("");
    }
    if (comparaison.permissionsInconnues.length) {
      o.push(`**Permissions de la base inconnues du document** : ${codes(comparaison.permissionsInconnues)}.`);
      o.push("");
    }
    for (const e of comparaison.ecarts) {
      o.push(`### ${e.role}`);
      o.push("");
      if (e.manquantes.length) o.push(`- À **cocher** (manquantes) : ${codes(e.manquantes)}.`);
      if (e.enTrop.length) o.push(`- À **décocher** (en trop) : ${codes(e.enTrop)}.`);
      for (const r of e.reglages) o.push(`- Réglage : ${r}.`);
      o.push("");
    }
  }
  if (comparaison.rolesInconnus.length) {
    o.push("");
    o.push(`**Rôles de la base absents du document** (créés à la main : non comparés, à vérifier) : ${comparaison.rolesInconnus.join(", ")}.`);
  }
  o.push("");

  o.push("## Rôles");
  o.push("");
  for (const r of roles) {
    o.push(`### ${r.name}`);
    o.push("");
    if (r.description) o.push(/[.!?]$/.test(r.description) ? r.description : `${r.description}.`, "");
    o.push(
      `- Administrateur : **${r.estAdmin ? "oui" : "non"}** · bénéficiaire de délégation : **${r.peutEtreBeneficiaireDelegation ? "oui" : "non"}** · peut recevoir un feedback : **${r.peutRecevoirFeedback ? "oui" : "non"}**`,
      `- Comptes actifs : **${r.nbComptesActifs}** · permissions : **${r.permissions.length}**`,
      ""
    );
    const parModule = new Map<string, string[]>();
    for (const k of [...r.permissions].sort()) {
      const m = libelle.get(k)?.moduleKey ?? "inconnu";
      parModule.set(m, [...(parModule.get(m) ?? []), k]);
    }
    for (const [m, cles] of parModule) {
      o.push(`**${m}** (${cles.length})`, "");
      for (const k of cles) o.push(`- [x] \`${k}\` — ${libelle.get(k)?.label ?? "(permission inconnue)"}`);
      o.push("");
    }
    if (r.permissions.length === 0) o.push("*(aucune permission)*", "");
  }
  return o.join("\n");
}

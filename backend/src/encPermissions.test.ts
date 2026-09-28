import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ENC_MODULE_KEY, ENC_PERMISSIONS, ENC_PERMISSION_MISE_EN_SERVICE, ENC_ROLES_DEPART } from "./encPermissions";

// Une base neuve applique les DEUX migrations dans l'ordre : la 3a (V1, jamais modifiée depuis qu'elle est poussée)
// puis cette migration corrective (V2). L'état final vient de leur COMBINAISON : les permissions conservées
// (consulter, importer_production, annuler_contrat) et les 3 rôles sont créés par la 3a, la corrective retire ce qui
// n'existe plus et ajoute ce qui est nouveau. Ce test vérifie donc les deux fichiers ensemble, jamais un seul isolé.
const sql3a = readFileSync(
  path.resolve(__dirname, "../prisma/migrations/20260927100000_encaissements_module/migration.sql"),
  "utf8"
);
const sqlCorrective = readFileSync(
  path.resolve(__dirname, "../prisma/migrations/20260928150000_encaissements_permissions_v2/migration.sql"),
  "utf8"
);
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

// Permissions du V1 (17) réellement insérées par la migration 3a — jamais réécrit à la main : extrait de son propre
// texte, pour que ce test ne puisse pas dériver silencieusement de ce que cette migration a vraiment créé.
const CLES_V1 = [...sql3a.matchAll(/'(enc\.[a-z_]+)'/g)].map((m) => m[1]).filter((k) => k !== "enc.mettre_en_service");
const CLES_V1_UNIQUES = [...new Set(CLES_V1)];

describe("Module Encaissements — permissions V2 (3 profils, 2026-09-28)", () => {
  it("la migration 3a a bien créé 17 permissions enc.* (V1) — sinon ce test vérifierait un diff dans le vide", () => {
    expect(CLES_V1_UNIQUES).toHaveLength(17);
  });

  it("chaque permission ACTUELLE (clé, libellé) figure dans la 3a (clés conservées) ou la corrective (clés nouvelles)", () => {
    for (const p of ENC_PERMISSIONS) {
      const dansLes2 = sql3a.includes(`${q(p.key)}, ${q(p.label)}`) || sqlCorrective.includes(`${q(p.key)}, ${q(p.label)}`);
      expect(dansLes2, `permission absente ou libellé différent : ${p.key}`).toBe(true);
    }
    expect(sql3a).toContain(`${q(ENC_PERMISSION_MISE_EN_SERVICE.key)}, ${q(ENC_PERMISSION_MISE_EN_SERVICE.label)}`);
  });

  it("les clés obsolètes du V1 (celles qui ne sont plus dans encPermissions.ts) sont bien retirées par la corrective", () => {
    const clesActuelles = new Set<string>(ENC_PERMISSIONS.map((p) => p.key));
    const obsoletes = CLES_V1_UNIQUES.filter((k) => !clesActuelles.has(k));
    expect(obsoletes.length).toBeGreaterThan(0); // sinon ce test ne vérifierait plus rien
    const deleteRolePermission = /DELETE FROM "RolePermission"[^;]*"Permission"[^;]*;/.exec(sqlCorrective)?.[0] ?? "";
    const deletePermission = /DELETE FROM "Permission" WHERE "key" IN \([^)]*\);/.exec(sqlCorrective)?.[0] ?? "";
    for (const k of obsoletes) {
      expect(deleteRolePermission, `RolePermission de ${k} non supprimée avant la permission`).toContain(q(k));
      expect(deletePermission, `permission obsolète ${k} non supprimée`).toContain(q(k));
    }
  });

  it("aucune clé enc.* actuelle n'est présente dans la liste des permissions supprimées", () => {
    const clesActuelles = new Set<string>([...ENC_PERMISSIONS.map((p) => p.key), ENC_PERMISSION_MISE_EN_SERVICE.key]);
    const deletePermission = /DELETE FROM "Permission" WHERE "key" IN \(([^)]*)\);/.exec(sqlCorrective)?.[1] ?? "";
    const clesSupprimees = [...deletePermission.matchAll(/'(enc\.[a-z_]+)'/g)].map((m) => m[1]);
    for (const k of clesSupprimees) expect(clesActuelles.has(k), `${k} est à la fois actuelle et supprimée`).toBe(false);
  });

  it("3 rôles de départ (plus 'Gestionnaire' et 'Responsable' du V1, explicitement supprimés)", () => {
    expect(ENC_ROLES_DEPART).toHaveLength(3);
    expect(ENC_ROLES_DEPART.map((r) => r.name)).toEqual([
      "Encaissements – Équipe technique",
      "Encaissements – Finance",
      "Encaissements – Consultation",
    ]);
    expect(sql3a).toContain(q("Encaissements – Gestionnaire"));
    expect(sql3a).toContain(q("Encaissements – Responsable"));
    expect(sqlCorrective).toMatch(/DELETE FROM "Role" WHERE "name" IN \([^)]*'Encaissements – Gestionnaire'[^)]*'Encaissements – Responsable'[^)]*\);/);
  });

  it("chaque rôle et chacune de ses permissions ACTUELLES figurent dans la 3a (grants conservés) ou la corrective (nouveaux grants)", () => {
    for (const r of ENC_ROLES_DEPART) {
      const nomEtDescriptionSync = sqlCorrective.includes(`${q(r.name)}, ${q(r.description)})`);
      const nomEtDescriptionOrigine = sql3a.includes(`${q(r.name)}, ${q(r.description)}`);
      expect(nomEtDescriptionSync || nomEtDescriptionOrigine, `rôle/description non synchronisés : ${r.name}`).toBe(true);
      for (const k of r.permissions) {
        const grantOrigine = sql3a.includes(`(${q(r.name)}, ${q(k)})`);
        const grantCorrectif = sqlCorrective.includes(`(${q(r.name)}, ${q(k)})`);
        expect(grantOrigine || grantCorrectif, `permission ${k} non accordée à ${r.name}`).toBe(true);
      }
    }
  });

  it("la migration corrective synchronise la description des 3 rôles conservés (jamais mise à jour par un simple ON CONFLICT DO NOTHING)", () => {
    expect(sqlCorrective).toMatch(/UPDATE "Role" r SET "description" = v\.description/);
    for (const r of ENC_ROLES_DEPART) expect(sqlCorrective).toContain(`${q(r.name)}, ${q(r.description)})`);
  });

  it("module, mise en service au module technique et au seul rôle DG, aucune validation de versement", () => {
    expect(sql3a).toContain(`'encaissements-module', ${q(ENC_MODULE_KEY)}`);
    expect(sql3a).toMatch(/'enc\.mettre_en_service'[^;]*WHERE m\."key" = 'systeme'/);
    expect(sql3a).toMatch(/r\."name" = 'DG' AND p\."key" = 'enc\.mettre_en_service'/);
    expect(sql3a + sqlCorrective).not.toMatch(/valider_versement/);
    expect(ENC_ROLES_DEPART.every((r) => !(r.permissions as string[]).includes(ENC_PERMISSION_MISE_EN_SERVICE.key))).toBe(true);
  });

  it("garde-fous : la corrective vérifie les comptes des rôles supprimés ET les délégations AVANT toute écriture", () => {
    expect(sqlCorrective).toMatch(/RAISE EXCEPTION 'ENC_MIGRATION_BLOQUEE/);
    expect(sqlCorrective).toMatch(/FROM "User" u JOIN "Role" r ON r\."id" = u\."roleId" WHERE r\."name" = 'Encaissements – Gestionnaire'/);
    expect(sqlCorrective).toMatch(/FROM "User" u JOIN "Role" r ON r\."id" = u\."roleId" WHERE r\."name" = 'Encaissements – Responsable'/);
    expect(sqlCorrective).toMatch(/"PermissionDelegation"/);
    // Le garde-fou doit précéder toute écriture (premier DO $$ … avant le premier INSERT/DELETE/UPDATE).
    const posGarde = sqlCorrective.indexOf("RAISE EXCEPTION 'ENC_MIGRATION_BLOQUEE");
    const posEcriture = Math.min(
      ...["INSERT INTO", "DELETE FROM", "UPDATE "].map((s) => {
        const i = sqlCorrective.indexOf(s);
        return i === -1 ? Infinity : i;
      })
    );
    expect(posGarde).toBeLessThan(posEcriture);
  });

  it("séparation des tâches du cahier V2.6 (§2) : seule l'équipe technique annule, jamais elle ne saisit d'encaissement", () => {
    const perms = (nom: string) => ENC_ROLES_DEPART.find((r) => r.name.endsWith(nom))!.permissions as string[];
    expect(perms("Équipe technique")).not.toContain("enc.saisir_encaissement");
    expect(perms("Équipe technique")).not.toContain("enc.corriger_encaissement");
    expect(perms("Équipe technique")).not.toContain("enc.marquer_paye");
    expect(ENC_ROLES_DEPART.filter((r) => (r.permissions as string[]).includes("enc.annuler_contrat")).map((r) => r.name)).toEqual([
      "Encaissements – Équipe technique",
    ]);
    expect(perms("Consultation")).toEqual(["enc.consulter"]);
    expect(ENC_ROLES_DEPART.every((r) => (r.permissions as string[]).includes("enc.consulter"))).toBe(true);
  });

  it("la reprise initiale (F1.5) est réservée à la Finance : elle seule détient importer_production ET marquer_paye", () => {
    const roles = ENC_ROLES_DEPART.filter(
      (r) => (r.permissions as string[]).includes("enc.importer_production") && (r.permissions as string[]).includes("enc.marquer_paye")
    );
    expect(roles.map((r) => r.name)).toEqual(["Encaissements – Finance"]);
  });

  it("9 permissions au total (validées le 2026-09-28), aucune permission de validation d'un versement", () => {
    expect(ENC_PERMISSIONS).toHaveLength(9);
    expect(ENC_PERMISSIONS.some((p) => /valider|validation/.test(p.key))).toBe(false);
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CPT_MODULE_KEY,
  CPT_MODULE_LABEL,
  CPT_PERMISSION_MISE_EN_SERVICE,
  CPT_PERMISSION_SOEUR_DG,
  CPT_PERMISSIONS,
  CPT_PERMISSIONS_DG,
  CPT_ROLES_DEPART,
} from "./cptPermissions";

// Synchronisation source unique (cptPermissions.ts) ↔ migration du lot GC-1c ↔ seed, sur le patron de congesPermissions.test.ts.
const RACINE = path.resolve(__dirname, "..");
const sql = readFileSync(path.join(RACINE, "prisma/migrations/20261101110000_compta_permissions_roles/migration.sql"), "utf8");
const seed = readFileSync(path.join(RACINE, "prisma/seed.ts"), "utf8");
const code = sql.replace(/^--.*$/gm, "");
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

describe("Gestion Compta — migration synchronisée avec cptPermissions.ts", () => {
  it("le module `compta` est créé avec son libellé", () => {
    expect(sql).toContain(`${q(CPT_MODULE_KEY)}, ${q(CPT_MODULE_LABEL)}`);
  });

  it("chaque permission (clé, libellé) figure dans la migration, et il n'y en a pas d'autre", () => {
    for (const p of CPT_PERMISSIONS) expect(sql, `absente ou libellé différent : ${p.key}`).toContain(`${q(p.key)}, ${q(p.label)}`);
    const inserees = [...code.matchAll(/\('perm-cpt-[a-z-]+', '(cpt\.[a-z_]+)'/g)].map((m) => m[1]);
    expect(inserees.sort()).toEqual(CPT_PERMISSIONS.map((p) => p.key as string).sort());
  });

  it("la mise en service est rattachée au module technique `systeme`, pas au module `compta`", () => {
    expect(sql).toContain(`${q(CPT_PERMISSION_MISE_EN_SERVICE.key)}, ${q(CPT_PERMISSION_MISE_EN_SERVICE.label)}`);
    expect(code).toMatch(/FROM "Module" m\s+WHERE m\."key" = 'systeme'/);
  });

  it("les 5 rôles de départ sont créés, sans droit d'administration ni délégation", () => {
    for (const r of CPT_ROLES_DEPART) expect(sql, r.name).toContain(`${q(r.name)}, ${q(r.description)}, false, false, true`);
    const crees = [...code.matchAll(/\('role-compta-\d', '([^']+)'/g)].map((m) => m[1]);
    expect(crees).toEqual(CPT_ROLES_DEPART.map((r) => r.name));
  });

  it("chaque couple (rôle, permission) figure dans la migration, exactement", () => {
    const attendus = CPT_ROLES_DEPART.flatMap((r) => r.permissions.map((k) => `(${q(r.name)}, ${q(k)})`));
    for (const couple of attendus) expect(sql, `couple absent : ${couple}`).toContain(couple);
    const dansLaMigration = [...code.matchAll(/\('(Compta – [^']+)', '(cpt\.[a-z_]+)'\)/g)];
    expect(dansLaMigration).toHaveLength(attendus.length);
  });

  it("le DG superviseur reçoit consulter, trancher_litige et mise en service — par permission sœur, jamais par nom de rôle", () => {
    expect([...CPT_PERMISSIONS_DG].sort()).toEqual(["cpt.consulter", "cpt.mettre_en_service", "cpt.trancher_litige"]);
    expect(CPT_PERMISSION_SOEUR_DG).toBe("systeme.reinitialiser");
    for (const k of CPT_PERMISSIONS_DG) expect(sql, k).toContain(`(${q(k)}, ${q(CPT_PERMISSION_SOEUR_DG)})`);
    const couplesDG = [...code.matchAll(/\('(cpt\.[a-z_]+)', 'systeme\.reinitialiser'\)/g)];
    expect(couplesDG).toHaveLength(CPT_PERMISSIONS_DG.length);
    expect(code).not.toMatch(/"Role"[^;]*"name" = 'DG'/);
    expect(code).not.toMatch(/r\."name" = 'DG'/);
  });

  it("le DG ne reçoit AUCUNE permission de saisie ni de décision comptable", () => {
    for (const k of CPT_PERMISSIONS.map((p) => p.key as string)) {
      if ((CPT_PERMISSIONS_DG as readonly string[]).includes(k)) continue;
      expect(sql, `le DG ne doit pas recevoir ${k}`).not.toContain(`(${q(k)}, ${q(CPT_PERMISSION_SOEUR_DG)})`);
    }
  });

  it("la migration touche les seuls objets du module : aucun rôle existant n'est modifié ni supprimé", () => {
    expect(code).not.toMatch(/\b(UPDATE|DELETE)\b/);
    expect(code).not.toMatch(/Encaissements|"Role"[^;]*'(Finance|RH|Collaborateur|Assistant Finance|Admin)'/);
  });

  it("la migration est rejouable : toute insertion porte un ON CONFLICT, aucun CREATE", () => {
    const insertions = code.match(/^INSERT INTO/gm) ?? [];
    const conflits = code.match(/ON CONFLICT/g) ?? [];
    expect(insertions.length).toBeGreaterThan(0);
    expect(conflits).toHaveLength(insertions.length);
    expect(code).not.toMatch(/^(CREATE|ALTER|DROP) /m);
  });
});

describe("Gestion Compta — seed synchronisé avec la même source", () => {
  it("le seed lit la source unique au lieu de dupliquer les permissions", () => {
    for (const nom of ["CPT_PERMISSIONS", "CPT_PERMISSIONS_DG", "CPT_ROLES_DEPART", "CPT_PERMISSION_MISE_EN_SERVICE", "CPT_PARAMETRES"]) {
      expect(seed, nom).toContain(nom);
    }
    expect(seed).not.toMatch(/"cpt\.[a-z_]+"/);
  });

  it("le seed ne crée les comptes de test qu'hors production et refuse un module mis en service", () => {
    expect(seed).toContain("prisma.cptMiseEnService.count()");
    const i = seed.indexOf("CPT_ROLES_DEPART.map((r, i) => ({ ...r.compteTest");
    expect(i).toBeGreaterThan(-1);
    expect(seed.slice(i - 200, i)).toContain('process.env.NODE_ENV === "production"');
  });

  it("le seed vide les tables Cpt* avant les comptes (clés étrangères vers User)", () => {
    const iUser = seed.indexOf("await prisma.user.deleteMany()");
    for (const t of ["cptAudit", "cptPieceJointe", "cptPeriode", "cptSequence", "cptParametre"]) {
      const i = seed.indexOf(`await prisma.${t}.deleteMany()`);
      expect(i, t).toBeGreaterThan(-1);
      expect(i, t).toBeLessThan(iUser);
    }
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS_CATALOGUE, ROLES_CIBLES } from "./rolesCibles";
import {
  COUPLES_INTERDITS,
  DESCRIPTIONS,
  PERMISSIONS_DG_SEUL,
  PERMISSIONS_RECENTES,
  POINTS_A_VALIDER,
  decompteCatalogueParModule,
  decompteParModule,
  genererDocRoles,
  rolesPortant,
} from "./rolesDocumentation";
import { PERMISSIONS_DECISION_NON_DELEGABLES } from "./circuitDemande";

describe("rolesCibles : cohérence", () => {
  it("toute permission portée par un rôle existe au catalogue, sans doublon", () => {
    const cles = new Set(PERMISSIONS_CATALOGUE.map((p) => p.key));
    expect(cles.size).toBe(PERMISSIONS_CATALOGUE.length);
    for (const r of ROLES_CIBLES) {
      expect(new Set(r.permissions).size).toBe(r.permissions.length);
      for (const k of r.permissions) expect(cles.has(k), `${r.name} : ${k}`).toBe(true);
    }
  });

  it("le catalogue compte 52 permissions et 9 rôles", () => {
    expect(PERMISSIONS_CATALOGUE).toHaveLength(52);
    expect(ROLES_CIBLES).toHaveLength(9);
    expect(ROLES_CIBLES.reduce((n, r) => n + r.permissions.length, 0)).toBe(76);
  });

  it("aucun couple interdit n'est porté", () => {
    for (const c of COUPLES_INTERDITS) {
      expect(rolesPortant(c.cle), `${c.roles} / ${c.cle}`).not.toContain(c.roles);
    }
  });

  it("les permissions réservées au DG ne sont portées que par le DG", () => {
    for (const r of PERMISSIONS_DG_SEUL) {
      const roles = rolesPortant(r.cle);
      expect(roles.every((n) => n === "DG"), r.cle).toBe(true);
    }
  });

  it("un rôle Administrateur ne reçoit des Congés que le droit de demande", () => {
    const admin = ROLES_CIBLES.find((r) => r.estAdmin)!;
    expect(admin.permissions.filter((k) => k.startsWith("conges."))).toEqual([]);
  });
});

describe("docs/roles-et-permissions.md", () => {
  it("chaque permission a une description", () => {
    for (const p of PERMISSIONS_CATALOGUE) expect(DESCRIPTIONS[p.key], p.key).toBeTruthy();
    expect(Object.keys(DESCRIPTIONS).sort()).toEqual(PERMISSIONS_CATALOGUE.map((p) => p.key).sort());
  });

  it("les permissions citées dans les encadrés existent", () => {
    const cles = new Set(PERMISSIONS_CATALOGUE.map((p) => p.key));
    for (const r of PERMISSIONS_RECENTES) for (const k of r.cles) expect(cles.has(k), k).toBe(true);
    for (const c of COUPLES_INTERDITS) expect(cles.has(c.cle), c.cle).toBe(true);
    for (const c of PERMISSIONS_DECISION_NON_DELEGABLES) expect(cles.has(c) || c.startsWith("pointage."), c).toBe(true);
  });

  it("le document cite toutes les permissions non délégables", () => {
    const doc = genererDocRoles();
    for (const k of PERMISSIONS_DECISION_NON_DELEGABLES) expect(doc, k).toContain(`\`${k}\``);
  });

  it("chaque rôle a sa section avec une case par permission", () => {
    const doc = genererDocRoles();
    for (const r of ROLES_CIBLES) {
      expect(doc).toContain(`### ${r.name}`);
      for (const k of r.permissions) expect(doc).toContain(`- [ ] \`${k}\` — `);
    }
    expect(doc).toContain("## Permissions réservées");
    expect(doc).toContain("## Vérifier avant de cocher");
    expect(doc).toContain("## Tableau des permissions");
    for (const p of POINTS_A_VALIDER) expect(doc).toContain(`À VALIDER PAR LE DG — ${p.id}.`);
  });

  it("le décompte par module est cohérent", () => {
    const total = Object.values(decompteCatalogueParModule()).reduce((a, b) => a + b, 0);
    expect(total).toBe(52);
    const dg = ROLES_CIBLES.find((r) => r.name === "DG")!;
    expect(Object.values(decompteParModule(dg)).reduce((a, b) => a + b, 0)).toBe(dg.permissions.length);
  });

  it("le fichier du dépôt est à jour (npx tsx prisma/generer-doc-roles.ts)", () => {
    const fichier = path.resolve(__dirname, "../../docs/roles-et-permissions.md");
    expect(fs.readFileSync(fichier, "utf-8")).toBe(genererDocRoles());
  });
});

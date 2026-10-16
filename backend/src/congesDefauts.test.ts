import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PERMISSIONS_DECISION_NON_DELEGABLES } from "./circuitDemande";
import {
  MODULE_ABSENCES_KEY,
  MODULE_CONGES_KEY,
  PERMISSIONS_CONGES_ET_ABSENCES,
  PERMISSIONS_ETAPE_RH_ABSENCE,
  TYPES_CONGE_DEFAUT,
  TYPES_PERMISSION_DEFAUT,
  permissionsAbsencePourCles,
} from "./congesDefauts";

const sql = readFileSync(
  path.resolve(__dirname, "../prisma/migrations/20261021090000_conges_permissions_absence/migration.sql"),
  "utf8"
);
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

describe("Congés et permissions d'absence — source unique et migration synchronisées", () => {
  it("chaque permission (clé, libellé, module) figure dans la migration", () => {
    for (const p of PERMISSIONS_CONGES_ET_ABSENCES) {
      expect(sql, `permission absente ou libellé différent : ${p.key}`).toContain(`${q(p.key)}, ${q(p.label)}, ${q(p.module)}`);
    }
  });

  it("chaque couple (nouvelle permission, permission sœur) figure dans la migration, et inversement", () => {
    const attendus = PERMISSIONS_CONGES_ET_ABSENCES.flatMap((p) => p.soeurs.map((s) => `(${q(p.key)}, ${q(s)})`));
    for (const couple of attendus) expect(sql, `couple absent : ${couple}`).toContain(couple);
    const dansLaMigration = [...sql.matchAll(/\('((?:conges|absences)\.[a-z_]+)', '((?:pointage|treso)\.[a-z_]+)'\)/g)];
    expect(dansLaMigration).toHaveLength(attendus.length);
  });

  it("les deux modules sont créés avec leurs clés (D7b : « absences », jamais « permissions »)", () => {
    expect(sql).toContain(q(MODULE_CONGES_KEY));
    expect(sql).toContain(q(MODULE_ABSENCES_KEY));
    expect(MODULE_ABSENCES_KEY).toBe("absences");
    expect(PERMISSIONS_CONGES_ET_ABSENCES.every((p) => !p.key.startsWith("permissions."))).toBe(true);
  });

  it("types de congé et de permission : mêmes valeurs dans la migration", () => {
    for (const t of TYPES_CONGE_DEFAUT) {
      const ligne = `(${q(t.code)}, ${q(t.label)}, '${t.categorie}'::"CategorieConge", ${t.nbJoursDefaut}, '${t.decompteType}'::"DecompteType", ${t.justificatifObligatoire}, ${t.nonDeductibleSolde}, ${t.ancienneteMinimumMois})`;
      expect(sql, `type de congé absent ou différent : ${t.code}`).toContain(ligne);
    }
    for (const t of TYPES_PERMISSION_DEFAUT) {
      expect(sql).toContain(`(${q(t.label)}, ${t.dureeMaxHeures}, ${t.plafondMensuel}, ${t.justificatifRecommande})`);
    }
  });

  it("aucune attribution par nom de rôle dans la migration", () => {
    expect(sql).not.toMatch(/"Role"[^;]*"name"/);
    expect(sql).not.toMatch(/r\."name"/);
  });

  it("la migration est rejouable : aucun CREATE sans garde, aucune insertion sans ON CONFLICT", () => {
    expect(sql).not.toMatch(/^CREATE TABLE "/m);
    expect(sql).not.toMatch(/^CREATE (UNIQUE )?INDEX "/m);
    expect(sql).not.toMatch(/^ALTER TABLE [^\n]*ADD COLUMN "/m);
    const sansCommentaires = sql.replace(/^--.*$/gm, "");
    const insertions = sansCommentaires.match(/^INSERT INTO/gm) ?? [];
    const conflits = sansCommentaires.match(/ON CONFLICT/g) ?? [];
    expect(insertions.length).toBeGreaterThan(0);
    expect(conflits).toHaveLength(insertions.length);
  });

  it("l'étape RH de chaque module est une permission de décision NON délégable", () => {
    for (const k of PERMISSIONS_ETAPE_RH_ABSENCE) {
      expect(PERMISSIONS_CONGES_ET_ABSENCES.some((p) => p.key === k)).toBe(true);
      expect(PERMISSIONS_DECISION_NON_DELEGABLES).toContain(k);
    }
  });

  it("aucune permission « responsable » : le responsable est désigné par le service, pas par un droit", () => {
    expect(PERMISSIONS_CONGES_ET_ABSENCES.some((p) => /approuver_responsable|\.approuver$/.test(p.key))).toBe(false);
  });
});

describe("permissionsAbsencePourCles — la règle de la permission sœur", () => {
  it("un rôle qui pointe peut demander un congé et une permission, rien de plus", () => {
    const cles = permissionsAbsencePourCles(["pointage.pointer", "pointage.consulter_historique"]);
    expect(cles.sort()).toEqual(["absences.soumettre", "conges.soumettre"]);
  });

  it("la RH (corriger_pointage) reçoit l'étape RH, les soldes et le paramétrage", () => {
    const cles = permissionsAbsencePourCles(["pointage.corriger_pointage"]);
    expect(cles).toEqual(expect.arrayContaining(["conges.valider_rh", "absences.valider_rh", "conges.gerer_soldes", "absences.parametrer"]));
    expect(cles).not.toContain("conges.soumettre");
  });

  it("le DG (decider_dg) demande et consulte, mais ne reçoit jamais l'étape RH", () => {
    const cles = permissionsAbsencePourCles(["treso.decider_dg"]);
    expect(cles).toEqual(expect.arrayContaining(["conges.soumettre", "absences.soumettre"]));
    expect(cles.some((c) => c.endsWith(".voir_dashboard") || c.endsWith(".voir_reporting"))).toBe(false);
    expect(cles).not.toContain("conges.valider_rh");
    expect(cles).not.toContain("absences.valider_rh");
  });

  it("un rôle sans permission sœur (ex. Admin seul) ne reçoit rien", () => {
    expect(permissionsAbsencePourCles(["feedback.moderer", "pointage.reinitialiser"])).toEqual([]);
  });
});

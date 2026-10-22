import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PERMISSIONS_DECISION_NON_DELEGABLES } from "./circuitDemande";
import { MODULE_CONGES_KEY, PERMISSIONS_CONGES, permissionsCongePourCles } from "./congesPermissions";

const sql = readFileSync(
  path.resolve(__dirname, "../prisma/migrations/20261030090000_conges_permissions_absence/migration.sql"),
  "utf8"
);
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

describe("Congés — source unique et migration synchronisées", () => {
  it("chaque permission (clé, libellé, module) figure dans la migration", () => {
    for (const p of PERMISSIONS_CONGES) {
      expect(sql, `permission absente ou libellé différent : ${p.key}`).toContain(`${q(p.key)}, ${q(p.label)}, ${q(p.module)}`);
    }
  });

  it("chaque couple (nouvelle permission, permission sœur) figure dans la migration", () => {
    const attendus = PERMISSIONS_CONGES.flatMap((p) => p.soeurs.map((s) => `(${q(p.key)}, ${q(s)})`));
    for (const couple of attendus) expect(sql, `couple absent : ${couple}`).toContain(couple);
    const dansLaMigration = [...sql.matchAll(/\('(conges\.[a-z_]+)', '((?:pointage|treso)\.[a-z_]+)'\)/g)];
    expect(dansLaMigration).toHaveLength(attendus.length);
  });

  it("le module Congés est créé avec sa clé", () => {
    expect(sql).toContain(q(MODULE_CONGES_KEY));
    expect(MODULE_CONGES_KEY).toBe("conges");
  });

  it("la migration ne garde ni solde, ni type, ni permission d'absence, ni date d'embauche", () => {
    const code = sql.replace(/^--.*$/gm, "");
    expect(code).not.toMatch(/TypeConge|SoldeConge|AjustementSolde|PieceJointeConge|TypePermission|DemandePermission|ObservationAbsence|dateEmbauche/);
    expect(code).not.toContain("absences.");
    expect(PERMISSIONS_CONGES.map((p) => p.key)).toEqual(["conges.soumettre", "conges.valider_rh", "conges.annuler", "conges.consulter_tous"]);
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

  it("l'étape RH des congés est une permission de décision non délégable", () => {
    expect(PERMISSIONS_CONGES.some((p) => p.key === "conges.valider_rh")).toBe(true);
    expect(PERMISSIONS_DECISION_NON_DELEGABLES).toContain("conges.valider_rh");
  });

  it("aucune permission « responsable » : le responsable est désigné par le service, pas par un droit", () => {
    expect(PERMISSIONS_CONGES.some((p) => /approuver_responsable|\.approuver$/.test(p.key))).toBe(false);
  });
});

describe("permissionsCongePourCles — la règle de la permission sœur", () => {
  it("un rôle qui pointe peut demander un congé", () => {
    expect(permissionsCongePourCles(["pointage.pointer", "pointage.consulter_historique"])).toEqual(["conges.soumettre"]);
  });

  it("la RH (corriger_pointage) reçoit l'étape RH, l'annulation et la consultation, pas la demande", () => {
    const cles = permissionsCongePourCles(["pointage.corriger_pointage"]);
    expect(cles).toEqual(["conges.valider_rh", "conges.annuler", "conges.consulter_tous"]);
  });

  it("le DG (decider_dg) demande et consulte tout, mais ne reçoit jamais l'étape RH ni l'annulation", () => {
    const cles = permissionsCongePourCles(["treso.decider_dg"]);
    expect(cles).toEqual(["conges.soumettre", "conges.consulter_tous"]);
  });

  it("un rôle estAdmin ne reçoit que le droit de demander", () => {
    expect(permissionsCongePourCles(["pointage.pointer", "pointage.corriger_pointage", "treso.decider_dg"], true)).toEqual(["conges.soumettre"]);
  });

  it("un rôle sans permission sœur ne reçoit rien", () => {
    expect(permissionsCongePourCles(["feedback.moderer", "pointage.reinitialiser"])).toEqual([]);
  });
});

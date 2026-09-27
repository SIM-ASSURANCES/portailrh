import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ENC_MODULE_KEY, ENC_PERMISSIONS, ENC_PERMISSION_MISE_EN_SERVICE, ENC_ROLES_DEPART } from "./encPermissions";

// La migration idempotente et le seed doivent créer EXACTEMENT les mêmes lignes : ce test échoue si l'un bouge sans l'autre.
const sql = readFileSync(
  path.resolve(__dirname, "../prisma/migrations/20260927100000_encaissements_module/migration.sql"),
  "utf8"
);
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

describe("Module Encaissements — migration synchronisée avec encPermissions.ts", () => {
  it("chaque permission (clé et libellé) figure dans la migration", () => {
    for (const p of [...ENC_PERMISSIONS, ENC_PERMISSION_MISE_EN_SERVICE]) {
      expect(sql).toContain(`${q(p.key)}, ${q(p.label)}`);
    }
  });

  it("aucune permission enc.* de la migration n'est absente des constantes", () => {
    const connues = new Set<string>([...ENC_PERMISSIONS.map((p) => p.key), ENC_PERMISSION_MISE_EN_SERVICE.key]);
    const dansSql = new Set(sql.match(/'enc\.[a-z_]+'/g)?.map((s) => s.slice(1, -1)) ?? []);
    expect([...dansSql].filter((k) => !connues.has(k))).toEqual([]);
  });

  it("chaque rôle de départ et chacune de ses permissions figurent dans la migration", () => {
    for (const r of ENC_ROLES_DEPART) {
      expect(sql).toContain(`${q(r.name)}, ${q(r.description)}`);
      for (const k of r.permissions) expect(sql).toContain(`(${q(r.name)}, ${q(k)})`);
    }
  });

  it("module, mise en service au module technique et au seul rôle DG, aucune validation de versement", () => {
    expect(sql).toContain(`'encaissements-module', ${q(ENC_MODULE_KEY)}`);
    expect(sql).toMatch(/'enc\.mettre_en_service'[^;]*WHERE m\."key" = 'systeme'/);
    expect(sql).toMatch(/r\."name" = 'DG' AND p\."key" = 'enc\.mettre_en_service'/);
    expect(sql).not.toMatch(/valider_versement/);
    expect(ENC_ROLES_DEPART.every((r) => !(r.permissions as string[]).includes(ENC_PERMISSION_MISE_EN_SERVICE.key))).toBe(true);
  });

  it("séparation des tâches du cahier (§2) : la technique n'encaisse pas, seule la technique annule, la gestion n'annule pas", () => {
    const perms = (nom: string) => ENC_ROLES_DEPART.find((r) => r.name.endsWith(nom))!.permissions as string[];
    expect(perms("Équipe technique")).not.toContain("enc.saisir_versement");
    expect(ENC_ROLES_DEPART.filter((r) => (r.permissions as string[]).includes("enc.annuler_contrat")).map((r) => r.name)).toEqual([
      "Encaissements – Équipe technique",
    ]);
    expect(perms("Consultation")).toEqual(["enc.consulter"]);
    expect(ENC_ROLES_DEPART.every((r) => (r.permissions as string[]).includes("enc.consulter"))).toBe(true);
  });
});

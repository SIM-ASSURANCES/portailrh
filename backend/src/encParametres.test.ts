import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assemblerParametres,
  ENC_PARAMETRES,
  EncParametreError,
  lireValeurParametre,
  parametresExigibilite,
  tauxAccessoiresDefaut,
} from "./encParametres";

// L'état final d'`EncParametre` vient de DEUX migrations combinées (jamais d'édition de la première, déjà poussée) :
// 20260927142216 pose les 5 paramètres d'origine, 20260930000000 retire `taxe.delai_exigibilite_mois` (N+1 fixe,
// CDC V2.6 §5.3) et ajoute `accessoires.part_partenaire_defaut`.
const sqlSocle = readFileSync(
  path.resolve(__dirname, "../prisma/migrations/20260927142216_encaissements_socle_technique/migration.sql"),
  "utf8"
);
const sqlParametresV2 = readFileSync(
  path.resolve(__dirname, "../prisma/migrations/20260930000000_encaissements_parametres_v2/migration.sql"),
  "utf8"
);
const defauts = ENC_PARAMETRES.map((p) => ({ cle: p.cle, valeur: p.defaut }));

describe("Paramètres Encaissements — migrations synchronisées avec encParametres.ts", () => {
  it("chaque paramètre ACTUEL et sa valeur par défaut figurent dans l'une des deux migrations", () => {
    for (const p of ENC_PARAMETRES) {
      const insertion = `('${p.cle}', '${p.defaut}')`;
      expect(sqlSocle.includes(insertion) || sqlParametresV2.includes(insertion)).toBe(true);
    }
  });

  it("le délai d'exigibilité (retiré) est bien posé par le socle PUIS supprimé par la migration paramètres V2", () => {
    expect(sqlSocle).toContain("('taxe.delai_exigibilite_mois', '1')");
    expect(sqlParametresV2).toMatch(/DELETE FROM "EncParametre" WHERE "cle" = 'taxe\.delai_exigibilite_mois';/);
    expect(ENC_PARAMETRES.map((p): string => p.cle)).not.toContain("taxe.delai_exigibilite_mois");
  });

  it("la part partenaire par défaut est ajoutée par la migration paramètres V2, jamais par le socle", () => {
    expect(sqlSocle).not.toContain("accessoires.part_partenaire_defaut");
    expect(sqlParametresV2).toMatch(
      /INSERT INTO "EncParametre" \("cle", "valeur"\) VALUES \('accessoires\.part_partenaire_defaut', '0'\) ON CONFLICT \("cle"\) DO NOTHING;/
    );
  });

  it("aucune clé insérée par les deux migrations combinées (moins celle supprimée) n'est absente des constantes, et réciproquement", () => {
    const clesInserees = new Set<string>();
    for (const sql of [sqlSocle, sqlParametresV2]) {
      const bloc = sql.slice(sql.indexOf('INSERT INTO "EncParametre"'));
      for (const m of bloc.matchAll(/\('([a-z_.]+)', '/g)) clesInserees.add(m[1]);
    }
    clesInserees.delete("taxe.delai_exigibilite_mois");
    expect([...clesInserees].sort()).toEqual(ENC_PARAMETRES.map((p) => p.cle).sort());
  });

  it("le jour limite de reversement reste borné 1..28 en base aussi (CHECK ajouté par la migration paramètres V2)", () => {
    expect(sqlParametresV2).toMatch(/ADD CONSTRAINT "EncParametre_jour_limite_borne" CHECK/);
    expect(sqlParametresV2).toContain("taxe.jour_limite_reversement");
    expect(sqlParametresV2).toContain("BETWEEN 1 AND 28");
  });

  it("valeurs du cahier : reversement avant le 20, tolérance 1 FCFA, part partenaire par défaut à 0", () => {
    const p = assemblerParametres(defauts);
    expect(parametresExigibilite(p)).toEqual({ jourLimite: 20 });
    expect(p["controle.tolerance_fcfa"]).toBe(1);
    expect(p["accessoires.part_partenaire_defaut"]).toBe(0);
  });
});

describe("Paramètres Encaissements — lecture typée, jamais de repli silencieux", () => {
  it("refuse une valeur non numérique, hors bornes ou une clé inconnue", () => {
    expect(() => lireValeurParametre("taxe.jour_limite_reversement", "vingt")).toThrow(EncParametreError);
    expect(() => lireValeurParametre("taxe.jour_limite_reversement", "29")).toThrow(/hors bornes/);
    expect(() => lireValeurParametre("taxe.jour_limite_reversement", "20.5")).toThrow(EncParametreError);
    expect(() => lireValeurParametre("inconnu", "1")).toThrow(/inconnu/);
  });

  it("accepte un montant au centime pour la tolérance, pas au-delà", () => {
    expect(lireValeurParametre("controle.tolerance_fcfa", "0.50")).toBe(0.5);
    expect(() => lireValeurParametre("controle.tolerance_fcfa", "0.505")).toThrow(EncParametreError);
  });

  it("type « taux » : accepte jusqu'à 6 décimales entre 0 et 1, refuse au-delà ou hors bornes", () => {
    expect(lireValeurParametre("accessoires.part_partenaire_defaut", "0.4")).toBe(0.4);
    expect(lireValeurParametre("accessoires.part_partenaire_defaut", "0.400000")).toBe(0.4);
    expect(lireValeurParametre("accessoires.part_partenaire_defaut", "1")).toBe(1);
    expect(() => lireValeurParametre("accessoires.part_partenaire_defaut", "0.4000001")).toThrow(EncParametreError);
    expect(() => lireValeurParametre("accessoires.part_partenaire_defaut", "1.5")).toThrow(/hors bornes/);
    expect(() => lireValeurParametre("accessoires.part_partenaire_defaut", "-0.1")).toThrow(EncParametreError);
  });

  it("un paramètre absent en base est une erreur, pas le défaut", () => {
    expect(() => assemblerParametres(defauts.filter((d) => d.cle !== "taxe.jour_limite_reversement"))).toThrow(/manquant/);
  });
});

describe("tauxAccessoiresDefaut — formaté pour choisirTauxAccessoires/partagerAccessoires (encCalcul.ts)", () => {
  it("reconvertit la valeur typée en chaîne à 6 décimales, jamais un number nu", () => {
    const p = assemblerParametres(defauts);
    expect(tauxAccessoiresDefaut(p)).toBe("0.000000");
    expect(tauxAccessoiresDefaut({ ...p, "accessoires.part_partenaire_defaut": 0.4 })).toBe("0.400000");
  });
});

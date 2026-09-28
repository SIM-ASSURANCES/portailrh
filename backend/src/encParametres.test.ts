import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { assemblerParametres, ENC_PARAMETRES, EncParametreError, lireValeurParametre, parametresExigibilite } from "./encParametres";

const sql = readFileSync(
  path.resolve(__dirname, "../prisma/migrations/20260927142216_encaissements_socle_technique/migration.sql"),
  "utf8"
);
const defauts = ENC_PARAMETRES.map((p) => ({ cle: p.cle, valeur: p.defaut }));

describe("Paramètres Encaissements — migration synchronisée avec encParametres.ts", () => {
  it("chaque paramètre et sa valeur par défaut figurent dans la migration, sans écraser une valeur existante", () => {
    for (const p of ENC_PARAMETRES) expect(sql).toContain(`('${p.cle}', '${p.defaut}')`);
    expect(sql).toMatch(/INSERT INTO "EncParametre"[^;]*ON CONFLICT \("cle"\) DO NOTHING;/);
  });

  it("aucune clé de la migration n'est absente des constantes", () => {
    const bloc = sql.slice(sql.indexOf('INSERT INTO "EncParametre"'));
    const cles = [...bloc.matchAll(/\('([a-z_.]+)', '/g)].map((m) => m[1]);
    expect(cles.sort()).toEqual(ENC_PARAMETRES.map((p) => p.cle).sort());
  });

  it("valeurs du cahier : exigibilité N+1, reversement avant le 20, tolérance 1 FCFA", () => {
    const p = assemblerParametres(defauts);
    expect(parametresExigibilite(p)).toEqual({ delaiMois: 1, jourLimite: 20 });
    expect(p["controle.tolerance_fcfa"]).toBe(1);
  });
});

describe("Paramètres Encaissements — lecture typée, jamais de repli silencieux", () => {
  it("refuse une valeur non numérique, hors bornes ou une clé inconnue", () => {
    expect(() => lireValeurParametre("taxe.jour_limite_reversement", "vingt")).toThrow(EncParametreError);
    expect(() => lireValeurParametre("taxe.jour_limite_reversement", "32")).toThrow(/hors bornes/);
    expect(() => lireValeurParametre("taxe.jour_limite_reversement", "20.5")).toThrow(EncParametreError);
    expect(() => lireValeurParametre("inconnu", "1")).toThrow(/inconnu/);
  });

  it("accepte un montant au centime pour la tolérance, pas au-delà", () => {
    expect(lireValeurParametre("controle.tolerance_fcfa", "0.50")).toBe(0.5);
    expect(() => lireValeurParametre("controle.tolerance_fcfa", "0.505")).toThrow(EncParametreError);
  });

  it("un paramètre absent en base est une erreur, pas le défaut", () => {
    expect(() => assemblerParametres(defauts.filter((d) => d.cle !== "taxe.jour_limite_reversement"))).toThrow(/manquant/);
  });
});

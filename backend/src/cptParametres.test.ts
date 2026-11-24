import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assemblerParametres,
  CPT_PARAMETRES,
  CptParametreError,
  fenetresRapprochement,
  lireValeurParametre,
  seuilsRelance,
  verifierCoherence,
} from "./cptParametres";

const sql = readFileSync(
  path.resolve(__dirname, "../prisma/migrations/20261101100000_compta_parametres_defauts/migration.sql"),
  "utf8"
);
const defauts = CPT_PARAMETRES.map((p) => ({ cle: p.cle, valeur: p.defaut }));
const sansCommentaires = sql.replace(/^--.*$/gm, "");

describe("Paramètres Gestion Compta — migration synchronisée avec cptParametres.ts", () => {
  it("chaque paramètre et sa valeur par défaut figurent dans la migration", () => {
    for (const p of CPT_PARAMETRES) {
      expect(sql, `paramètre absent ou valeur différente : ${p.cle}`).toContain(`('${p.cle}', '${p.defaut}')`);
    }
  });

  it("aucune clé insérée par la migration n'est absente des constantes, et réciproquement", () => {
    const bloc = sansCommentaires.slice(sansCommentaires.indexOf('INSERT INTO "CptParametre"'), sansCommentaires.indexOf("ON CONFLICT"));
    const cles = [...bloc.matchAll(/\('([a-z_.]+)', '/g)].map((m) => m[1]);
    expect(cles.sort()).toEqual(CPT_PARAMETRES.map((p) => p.cle).sort());
  });

  it("la migration est rejouable et n'écrase jamais une valeur modifiée (ON CONFLICT DO NOTHING)", () => {
    expect(sansCommentaires).toMatch(/ON CONFLICT \("cle"\) DO NOTHING;/);
    expect(sansCommentaires).not.toMatch(/ON CONFLICT[^;]*DO UPDATE/);
    expect(sansCommentaires).not.toMatch(/^CREATE TABLE/m);
    expect(sansCommentaires).toContain("IF NOT EXISTS (SELECT 1 FROM pg_constraint");
  });

  it("le jour limite de paiement reste borné 1..28 en base, avec un CASE (ordre d'évaluation garanti)", () => {
    expect(sansCommentaires).toContain('"CptParametre_jour_limite_borne"');
    expect(sansCommentaires).toContain("tca.jour_limite_paiement");
    expect(sansCommentaires).toContain("BETWEEN 1 AND 28");
    expect(sansCommentaires).toMatch(/CASE[\s\S]*WHEN "cle" <> 'tca\.jour_limite_paiement' THEN true/);
  });

  it("ne touche aucune table d'un autre module", () => {
    expect(sansCommentaires).not.toMatch(/EncParametre|ParametreTresorerie/);
  });
});

describe("Paramètres Gestion Compta — valeurs du cahier SIM-XX-XX", () => {
  const p = assemblerParametres(defauts);

  it("taxe payée avant le 20 du mois suivant", () => {
    expect(p["tca.jour_limite_paiement"]).toBe(20);
  });

  it("rattachement : 1 FCFA, de 3 jours avant à 5 jours après, ±2 % sur ±45 jours, 12 caractères", () => {
    expect(fenetresRapprochement(p)).toEqual({
      toleranceMontantFcfa: 1,
      joursAvant: 3,
      joursApres: 5,
      probableEcartTaux: 0.02,
      probableJours: 45,
      caracteresReference: 12,
    });
  });

  it("contrôle hebdomadaire : relance à 7 jours, alerte à 30 jours, escalade à 60 jours", () => {
    expect(seuilsRelance(p)).toEqual({ relanceJours: 7, alerteJours: 30, escaladeJours: 60 });
  });

  it("import : 10 Mo et 50 000 lignes", () => {
    expect(p["import.limite_taille_mo"]).toBe(10);
    expect(p["import.limite_lignes"]).toBe(50000);
  });

  it("la taille maximale d'un dépôt ne peut pas dépasser 10 Mo (plafond de réception de Next.js)", () => {
    expect(lireValeurParametre("import.limite_taille_mo", "10")).toBe(10);
    expect(() => lireValeurParametre("import.limite_taille_mo", "11")).toThrow();
    expect(() => lireValeurParametre("import.limite_taille_mo", "50")).toThrow();
  });
});

describe("Paramètres Gestion Compta — lecture typée, jamais de repli silencieux", () => {
  it("refuse une valeur non numérique, hors bornes ou une clé inconnue", () => {
    expect(() => lireValeurParametre("tca.jour_limite_paiement", "vingt")).toThrow(CptParametreError);
    expect(() => lireValeurParametre("tca.jour_limite_paiement", "29")).toThrow(/hors bornes/);
    expect(() => lireValeurParametre("tca.jour_limite_paiement", "20.5")).toThrow(CptParametreError);
    expect(() => lireValeurParametre("inconnu", "1")).toThrow(/inconnu/);
  });

  it("accepte un montant au centime pour la tolérance, pas au-delà", () => {
    expect(lireValeurParametre("rattachement.tolerance_montant_fcfa", "0.50")).toBe(0.5);
    expect(() => lireValeurParametre("rattachement.tolerance_montant_fcfa", "0.505")).toThrow(CptParametreError);
  });

  it("type « taux » : jusqu'à 6 décimales entre 0 et 1, rien au-delà", () => {
    expect(lireValeurParametre("rattachement.probable_ecart_taux", "0.05")).toBe(0.05);
    expect(lireValeurParametre("rattachement.probable_ecart_taux", "1")).toBe(1);
    expect(() => lireValeurParametre("rattachement.probable_ecart_taux", "0.0500001")).toThrow(CptParametreError);
    expect(() => lireValeurParametre("rattachement.probable_ecart_taux", "1.5")).toThrow(/hors bornes/);
    expect(() => lireValeurParametre("rattachement.probable_ecart_taux", "-0.1")).toThrow(CptParametreError);
  });

  it("un paramètre absent en base est une erreur, pas le défaut", () => {
    expect(() => assemblerParametres(defauts.filter((d) => d.cle !== "alerte.jours"))).toThrow(/manquant/);
  });

  it("une valeur illisible en base est une erreur, pas le défaut", () => {
    const lignes = defauts.map((d) => (d.cle === "relance.jours" ? { ...d, valeur: "sept" } : d));
    expect(() => assemblerParametres(lignes)).toThrow(CptParametreError);
  });
});

describe("Paramètres Gestion Compta — cohérence relance < alerte < escalade", () => {
  const base = assemblerParametres(defauts);

  it("accepte des seuils strictement croissants", () => {
    expect(() => verifierCoherence({ ...base, "relance.jours": 5, "alerte.jours": 20, "escalade.jours": 90 })).not.toThrow();
  });

  it("refuse une escalade avant l'alerte, ou deux seuils égaux", () => {
    expect(() => verifierCoherence({ ...base, "alerte.jours": 70 })).toThrow(/croître/);
    expect(() => verifierCoherence({ ...base, "relance.jours": 30 })).toThrow(/croître/);
    expect(() => verifierCoherence({ ...base, "escalade.jours": 30 })).toThrow(/croître/);
  });

  it("l'assemblage depuis la base applique aussi cette règle", () => {
    const lignes = defauts.map((d) => (d.cle === "escalade.jours" ? { ...d, valeur: "10" } : d));
    expect(() => assemblerParametres(lignes)).toThrow(/croître/);
  });
});

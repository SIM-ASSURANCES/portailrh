import { describe, expect, it } from "vitest";

import {
  CHAMPS_ODOO_CPT,
  ENTITES_ODOO_CPT,
  champsOdooManquantsCpt,
  estEntiteOdooCpt,
  resumeOdooCpt,
  validerCorrespondanceOdooCpt,
} from "./cptCorrespondancesOdoo";

describe("entités et champs", () => {
  it("quatre entités, chacune avec ses champs Odoo", () => {
    expect([...ENTITES_ODOO_CPT]).toEqual(["PARTENAIRE", "CLIENT", "PRODUIT", "COMPTE"]);
    expect(CHAMPS_ODOO_CPT.PARTENAIRE.map((c) => c.champ)).toEqual(["tiersOdoo"]);
    expect(CHAMPS_ODOO_CPT.CLIENT.map((c) => c.champ)).toEqual(["tiersOdoo"]);
    expect(CHAMPS_ODOO_CPT.PRODUIT.map((c) => c.champ)).toEqual(["compteOdoo"]);
    expect(CHAMPS_ODOO_CPT.COMPTE.map((c) => c.champ)).toEqual(["journalOdoo", "compteOdoo"]);
  });

  it("reconnaît une entité, refuse le reste", () => {
    expect(estEntiteOdooCpt("PRODUIT")).toBe(true);
    expect(estEntiteOdooCpt("TAUX")).toBe(false);
    expect(estEntiteOdooCpt(undefined)).toBe(false);
    expect(estEntiteOdooCpt(42)).toBe(false);
  });
});

describe("validation d'une saisie", () => {
  it("espaces réduits et bords retirés, vide = non renseigné", () => {
    const r = validerCorrespondanceOdooCpt("COMPTE", { journalOdoo: "  WAVE   BUS ", compteOdoo: "   " });
    expect(r).toEqual({ ok: true, valeur: { journalOdoo: "WAVE BUS", compteOdoo: null } });
  });

  it("un champ absent vaut non renseigné", () => {
    expect(validerCorrespondanceOdooCpt("PARTENAIRE", {})).toEqual({ ok: true, valeur: { tiersOdoo: null } });
  });

  it("seuls les champs de l'entité sont lus (le reste est ignoré)", () => {
    const r = validerCorrespondanceOdooCpt("PRODUIT", { compteOdoo: "411200", tiersOdoo: "T-1", nom: "x", code: "HACK" });
    expect(r).toEqual({ ok: true, valeur: { compteOdoo: "411200" } });
  });

  it("longueur maximale par champ (60 le tiers, 40 le compte et le journal)", () => {
    expect(validerCorrespondanceOdooCpt("CLIENT", { tiersOdoo: "a".repeat(60) }).ok).toBe(true);
    const tiers = validerCorrespondanceOdooCpt("CLIENT", { tiersOdoo: "a".repeat(61) });
    expect(tiers.ok).toBe(false);
    if (!tiers.ok) expect(tiers.erreurs.tiersOdoo).toContain("60 caractères");
    const compte = validerCorrespondanceOdooCpt("COMPTE", { journalOdoo: "j".repeat(41), compteOdoo: "c".repeat(40) });
    expect(compte.ok).toBe(false);
    if (!compte.ok) {
      expect(Object.keys(compte.erreurs)).toEqual(["journalOdoo"]);
      expect(compte.erreurs.journalOdoo).toContain("40 caractères");
    }
  });

  it("caractères de contrôle refusés, tabulation et saut de ligne ramenés à une espace", () => {
    const refuse = validerCorrespondanceOdooCpt("PRODUIT", { compteOdoo: "41\u0000" });
    expect(refuse.ok).toBe(false);
    if (!refuse.ok) expect(refuse.erreurs.compteOdoo).toContain("non admis");
    expect(validerCorrespondanceOdooCpt("PRODUIT", { compteOdoo: "41\t12\n00" })).toEqual({ ok: true, valeur: { compteOdoo: "41 12 00" } });
  });

  it("une valeur qui n'est pas un texte vaut non renseigné, jamais un objet écrit en base", () => {
    expect(validerCorrespondanceOdooCpt("PARTENAIRE", { tiersOdoo: { a: 1 } })).toEqual({ ok: true, valeur: { tiersOdoo: null } });
  });
});

describe("champs manquants et compteurs", () => {
  it("liste les champs vides d'une fiche", () => {
    expect(champsOdooManquantsCpt("COMPTE", { journalOdoo: "WAVE", compteOdoo: null })).toEqual(["Compte Odoo"]);
    expect(champsOdooManquantsCpt("COMPTE", {})).toEqual(["Journal Odoo", "Compte Odoo"]);
    expect(champsOdooManquantsCpt("COMPTE", { journalOdoo: "W", compteOdoo: "5" })).toEqual([]);
    expect(champsOdooManquantsCpt("PARTENAIRE", { tiersOdoo: "   " })).toEqual(["Tiers Odoo"]);
  });

  it("résume : total, complètes, à compléter (jamais plus de manquantes que de fiches)", () => {
    expect(resumeOdooCpt(4, 2)).toEqual({ total: 4, completes: 2, aCompleter: 2 });
    expect(resumeOdooCpt(0, 0)).toEqual({ total: 0, completes: 0, aCompleter: 0 });
    expect(resumeOdooCpt(3, 9)).toEqual({ total: 3, completes: 0, aCompleter: 3 });
    expect(resumeOdooCpt(3, -1)).toEqual({ total: 3, completes: 3, aCompleter: 0 });
  });
});

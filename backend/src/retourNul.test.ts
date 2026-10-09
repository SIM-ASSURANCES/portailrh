import { describe, expect, it } from "vitest";

import { detailRetourNulConstate, estRetourNul, referenceRecuRetour, rienARendre } from "./retourNul";

describe("estRetourNul", () => {
  it("Caisse à 0 : nul", () => {
    expect(estRetourNul({ montantARetourner: 0, mode: "CAISSE" })).toBe(true);
  });
  it("Caisse avec un résidu de virgule flottante sous le centime : nul", () => {
    expect(estRetourNul({ montantARetourner: 0.001, mode: "CAISSE" })).toBe(true);
  });
  it("Caisse avec un montant à rendre : non nul", () => {
    expect(estRetourNul({ montantARetourner: 1500, mode: "CAISSE" })).toBe(false);
  });
  it("Banque : jamais nul", () => {
    expect(estRetourNul({ montantARetourner: 0, mode: "BANQUE" })).toBe(false);
  });
});

describe("rienARendre", () => {
  it("solde nul ou négatif : rien à déclarer", () => {
    expect(rienARendre(0)).toBe(true);
    expect(rienARendre(-200)).toBe(true);
  });
  it("solde positif : une déclaration reste possible", () => {
    expect(rienARendre(0.01)).toBe(false);
    expect(rienARendre(10000)).toBe(false);
  });
});

describe("detailRetourNulConstate", () => {
  it("cite l'auteur, la date et les montants", () => {
    const d = detailRetourNulConstate({
      auteurNom: "Assistant Test",
      date: new Date("2026-10-08T09:30:00Z"),
      montantRegle: 50000,
      totalDepenses: 50000,
    });
    expect(d).toContain("Assistant Test");
    expect(d).toContain("08/10/2026");
    expect(d).toContain("09:30");
    expect(d).toContain("aucun mouvement de caisse");
  });
});

describe("referenceRecuRetour", () => {
  it("suit la convention des reçus de règlement", () => {
    expect(referenceRecuRetour("DEM-2026-000012", 2)).toBe("DEM-2026-000012-RC2");
  });
});

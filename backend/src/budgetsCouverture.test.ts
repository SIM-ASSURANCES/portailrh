import { describe, expect, it } from "vitest";

import {
  couvertureDepuisAjouts,
  lireCouverture,
  partieCouverteReglement,
  previsionBudget,
  totalCouvert,
  type ContexteBudget,
  type PerimetreBudget,
} from "./budgets";

const perimetre = (categorieId: string, budget: number, reserve: number): PerimetreBudget => ({
  parametrageId: `p-${categorieId}`,
  portee: "CATEGORIE",
  categorieId,
  libelle: `Cat ${categorieId}`,
  budget,
  reserve,
  seuil: { mode: "MONTANT", orange: 200_000, rouge: 50_000 },
});

const contexte = (): ContexteBudget => ({
  global: null,
  categories: { A: perimetre("A", 1_000_000, 900_000), B: perimetre("B", 5_000_000, 0) },
});

describe("Lot J bis — couverture du règlement par la confirmation du DG", () => {
  it("ne couvre que les articles des catégories arrivées au seuil rouge", () => {
    const ajouts = [
      { ligneId: "l1", categorieId: "A", montant: 80_000 },
      { ligneId: "l2", categorieId: "B", montant: 100_000 },
      { ligneId: "l3", categorieId: null, montant: 10_000 },
    ];
    const prevision = previsionBudget(contexte(), ajouts);
    expect(prevision.niveau).toBe("ROUGE");
    expect(couvertureDepuisAjouts(prevision, ajouts)).toEqual([{ ligneId: "l1", categorieId: "A", montant: 80_000 }]);
  });

  it("cumule deux ajouts du même article et garde la dépense directe sous un identifiant nul", () => {
    const ajouts = [
      { ligneId: null, categorieId: "A", montant: 30_000.5 },
      { categorieId: "A", montant: 20_000 },
    ];
    const prevision = previsionBudget(contexte(), ajouts);
    expect(couvertureDepuisAjouts(prevision, ajouts)).toEqual([{ ligneId: null, categorieId: "A", montant: 50_000.5 }]);
  });

  it("n'écrit rien quand aucune catégorie n'atteint le rouge", () => {
    const ajouts = [{ ligneId: "l1", categorieId: "B", montant: 100_000 }];
    expect(couvertureDepuisAjouts(previsionBudget(contexte(), ajouts), ajouts)).toEqual([]);
  });

  it("relit le JSON de la base en ignorant les entrées mal formées", () => {
    expect(lireCouverture(null)).toEqual([]);
    expect(lireCouverture("x")).toEqual([]);
    expect(
      lireCouverture([{ ligneId: "l1", categorieId: "A", montant: 10 }, { categorieId: "A", montant: 5 }, { categorieId: "", montant: 3 }, { categorieId: "A", montant: -1 }, null])
    ).toEqual([
      { ligneId: "l1", categorieId: "A", montant: 10 },
      { ligneId: null, categorieId: "A", montant: 5 },
    ]);
  });

  it("totalise par article et par catégorie, sans mélanger", () => {
    const c = [
      { ligneId: "l1", categorieId: "A", montant: 10 },
      { ligneId: "l1", categorieId: "A", montant: 5 },
      { ligneId: "l2", categorieId: "A", montant: 7 },
      { ligneId: "l1", categorieId: "B", montant: 9 },
      { ligneId: null, categorieId: "A", montant: 3 },
    ];
    expect(totalCouvert(c, "l1", "A")).toBe(15);
    expect(totalCouvert(c, "l2", "A")).toBe(7);
    expect(totalCouvert(c, "l1", "B")).toBe(9);
    expect(totalCouvert(c, null, "A")).toBe(3);
    expect(totalCouvert(c, "l9", "A")).toBe(0);
  });

  it("règlement dans la limite confirmée : tout est couvert", () => {
    expect(partieCouverteReglement({ montant: 80_000, couvertureTotale: 80_000, dejaRegle: 0 })).toEqual({ couvert: 80_000, aControler: 0 });
  });

  it("règlement partiel puis solde : la couverture se consomme au fil des règlements", () => {
    expect(partieCouverteReglement({ montant: 30_000, couvertureTotale: 80_000, dejaRegle: 0 })).toEqual({ couvert: 30_000, aControler: 0 });
    expect(partieCouverteReglement({ montant: 50_000, couvertureTotale: 80_000, dejaRegle: 30_000 })).toEqual({ couvert: 50_000, aControler: 0 });
  });

  it("règlement au-delà du montant confirmé : l'excédent reste soumis au contrôle du budget", () => {
    expect(partieCouverteReglement({ montant: 90_000, couvertureTotale: 80_000, dejaRegle: 0 })).toEqual({ couvert: 80_000, aControler: 10_000 });
    expect(partieCouverteReglement({ montant: 10_000, couvertureTotale: 80_000, dejaRegle: 80_000 })).toEqual({ couvert: 0, aControler: 10_000 });
  });

  it("sans confirmation, rien n'est couvert", () => {
    expect(partieCouverteReglement({ montant: 10, couvertureTotale: 0, dejaRegle: 0 })).toEqual({ couvert: 0, aControler: 10 });
  });

  it("calcule au centime", () => {
    expect(partieCouverteReglement({ montant: 0.3, couvertureTotale: 0.1 + 0.2, dejaRegle: 0 })).toEqual({ couvert: 0.3, aControler: 0 });
  });
});

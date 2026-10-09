import { describe, expect, it } from "vitest";

import {
  estFicheRegularisation,
  estLigneReste,
  planModificationDepense,
  refusMotifModification,
  resumeModificationDepense,
} from "./regularisationDepenses";

const fiche = {
  creeParAssistant: true,
  estReceptionne: false,
  dateRetour: null,
  mode: "CAISSE" as const,
  motifReouvertureExceptionnelle: null,
  signalementOrigineId: null,
};

describe("fiche de régularisation (détail sans retour de caisse)", () => {
  it("retour créé par l'Assistant, non réceptionné, non complété : fiche", () => {
    expect(estFicheRegularisation(fiche)).toBe(true);
  });
  it("complétée par le collaborateur, réceptionnée, Banque, réouverture ou complément : retour à total fixé", () => {
    expect(estFicheRegularisation({ ...fiche, dateRetour: new Date() })).toBe(false);
    expect(estFicheRegularisation({ ...fiche, estReceptionne: true })).toBe(false);
    expect(estFicheRegularisation({ ...fiche, mode: "BANQUE" })).toBe(false);
    expect(estFicheRegularisation({ ...fiche, motifReouvertureExceptionnelle: "Oubli constaté" })).toBe(false);
    expect(estFicheRegularisation({ ...fiche, signalementOrigineId: "s1" })).toBe(false);
    expect(estFicheRegularisation({ ...fiche, creeParAssistant: false })).toBe(false);
  });
  it("ligne de reste : « Dépenses non détaillées » sans motif Finance", () => {
    expect(estLigneReste({ objet: "Dépenses non détaillées", motifNonJustifie: null })).toBe(true);
    expect(estLigneReste({ objet: "Dépenses non détaillées", motifNonJustifie: "Pas de reçu" })).toBe(false);
    expect(estLigneReste({ objet: "Taxi", motifNonJustifie: null })).toBe(false);
  });
});

describe("modification et suppression d'une dépense détaillée", () => {
  const lignes = [
    { id: "a", montant: 15000, reste: false },
    { id: "b", montant: 10000, reste: false },
  ];

  it("fiche : baisse d'une dépense → le montant à rendre augmente d'autant", () => {
    const r = planModificationDepense({ fiche: true, lignes, cibleId: "a", nouveauMontant: 12500, disponibleFiche: 50000 });
    expect(r).toEqual({ ok: true, montantReste: 0, montantARetourner: 50000 - 12500 - 10000 });
  });

  it("fiche : suppression → la dépense sort du détail, à rendre recalculé", () => {
    const r = planModificationDepense({ fiche: true, lignes, cibleId: "b", nouveauMontant: null, disponibleFiche: 50000 });
    expect(r).toEqual({ ok: true, montantReste: 0, montantARetourner: 35000 });
  });

  it("fiche : jamais plus que le montant remis restant à expliquer", () => {
    const r = planModificationDepense({ fiche: true, lignes, cibleId: "a", nouveauMontant: 45000, disponibleFiche: 50000 });
    expect(r.ok).toBe(false);
  });

  it("retour à total fixé (déclaré ou réceptionné) : l'écart passe par la ligne de reste", () => {
    const avecReste = [...lignes, { id: "r", montant: 5000, reste: true }];
    expect(planModificationDepense({ fiche: false, lignes: avecReste, cibleId: "a", nouveauMontant: 12500, disponibleFiche: 0 })).toEqual({
      ok: true,
      montantReste: 7500,
      montantARetourner: null,
    });
    expect(planModificationDepense({ fiche: false, lignes: avecReste, cibleId: "b", nouveauMontant: null, disponibleFiche: 0 })).toEqual({
      ok: true,
      montantReste: 15000,
      montantARetourner: null,
    });
  });

  it("retour à total fixé : une hausse au-delà du reste est refusée (jamais d'argent créé)", () => {
    const r = planModificationDepense({ fiche: false, lignes, cibleId: "a", nouveauMontant: 16000, disponibleFiche: 0 });
    expect(r.ok).toBe(false);
  });

  it("montant nul ou négatif, ligne de reste, dépense étrangère : refusés", () => {
    expect(planModificationDepense({ fiche: true, lignes, cibleId: "a", nouveauMontant: 0, disponibleFiche: 50000 }).ok).toBe(false);
    expect(planModificationDepense({ fiche: false, lignes: [{ id: "r", montant: 1, reste: true }], cibleId: "r", nouveauMontant: 2, disponibleFiche: 0 }).ok).toBe(false);
    expect(planModificationDepense({ fiche: true, lignes, cibleId: "zz", nouveauMontant: 1, disponibleFiche: 50000 }).ok).toBe(false);
  });

  it("motif de modification obligatoire", () => {
    expect(refusMotifModification("")).toContain("obligatoire");
    expect(refusMotifModification("  ab ")).toContain("obligatoire");
    expect(refusMotifModification("Erreur de saisie")).toBeNull();
  });
});

describe("historique lisible", () => {
  it("modification : montant, libellé et type avant → après, avec le motif", () => {
    expect(
      resumeModificationDepense({
        avant: { libelle: "Taxi", montant: 15000, type: "justifiee" },
        apres: { libelle: "Taxi aéroport", montant: 12500, type: "sans_piece" },
        motif: "Erreur de saisie",
      })
    ).toBe(
      "Dépense modifiée : « Taxi » 15 000 FCFA → 12 500 FCFA, libellé « Taxi » → « Taxi aéroport », Dépense justifiée → Dépense sans pièce formelle, motif : Erreur de saisie"
    );
  });
  it("suppression", () => {
    expect(
      resumeModificationDepense({ avant: { libelle: "Repas", montant: 8000, type: "justifiee" }, apres: null, motif: "Doublon" })
    ).toBe("Dépense supprimée : « Repas » 8 000 FCFA (Dépense justifiée), motif : Doublon");
  });
});

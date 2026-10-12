import { describe, expect, it } from "vitest";

import * as regles from "./regularisationDepenses";
import {
  estFicheRegularisation,
  estLigneReste,
  planAjoutLignes,
  planModificationDepense,
  totauxDetailRetour,
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

describe("correction du détail après retour nul ou réception (2026-10-10)", () => {
  it("après un retour nul (réceptionné, 0 rendu) : total lié à remis − 0, lignes modifiables dans ce total", () => {
    // Constat : une seule ligne de 100 000, retour nul réceptionné ; la ligne baisse à 60 000 → 40 000 en reste.
    const r = planModificationDepense({
      fiche: false,
      lignes: [{ id: "a", montant: 100000, reste: false }],
      cibleId: "a",
      nouveauMontant: 60000,
      disponibleFiche: 0,
    });
    expect(r).toEqual({ ok: true, montantReste: 40000, montantARetourner: null });
  });

  it("après un retour réceptionné avec mouvement de caisse : hausse au-delà du total refusée", () => {
    // Remis 50 000, rendu 20 000 (écriture de caisse) : total dépensé lié = 30 000.
    const lignes = [
      { id: "a", montant: 25000, reste: false },
      { id: "r", montant: 5000, reste: true },
    ];
    expect(planModificationDepense({ fiche: false, lignes, cibleId: "a", nouveauMontant: 30000, disponibleFiche: 0 })).toEqual({
      ok: true,
      montantReste: 0,
      montantARetourner: null,
    });
    expect(planModificationDepense({ fiche: false, lignes, cibleId: "a", nouveauMontant: 30001, disponibleFiche: 0 }).ok).toBe(false);
  });

  it("« Détailler » le reste : nouvelles lignes prises sur le reste, jamais au-delà", () => {
    expect(planAjoutLignes({ fiche: false, totalActuel: 100000, reste: 40000, disponibleFiche: 0, ajout: [25000, 15000] })).toEqual({
      ok: true,
      montantReste: 0,
      montantARetourner: null,
    });
    expect(planAjoutLignes({ fiche: false, totalActuel: 100000, reste: 40000, disponibleFiche: 0, ajout: [45000] }).ok).toBe(false);
    expect(planAjoutLignes({ fiche: false, totalActuel: 100000, reste: 40000, disponibleFiche: 0, ajout: [] }).ok).toBe(false);
  });

  it("« Détailler » une fiche : le montant à rendre baisse d'autant", () => {
    expect(planAjoutLignes({ fiche: true, totalActuel: 30000, reste: 0, disponibleFiche: 50000, ajout: [5000] })).toEqual({
      ok: true,
      montantReste: 0,
      montantARetourner: 15000,
    });
    expect(planAjoutLignes({ fiche: true, totalActuel: 30000, reste: 0, disponibleFiche: 50000, ajout: [25000] }).ok).toBe(false);
  });

  it("recalcul des totaux : détaillé, reste, non justifié, retourné", () => {
    const lignes = [
      { montant: 60000, reste: false, sansPiece: true },
      { montant: 25000, reste: false, sansPiece: false },
      { montant: 15000, reste: true, sansPiece: true },
    ];
    expect(totauxDetailRetour({ montantRegle: 100000, fiche: false, estReceptionne: true, montantARetourner: 0, lignes })).toEqual({
      remis: 100000,
      detaille: 85000,
      reste: 15000,
      nonJustifie: 60000,
      retourne: 0,
    });
    expect(totauxDetailRetour({ montantRegle: 50000, fiche: true, estReceptionne: false, montantARetourner: 20000, lignes: [lignes[1]] }).reste).toBe(20000);
  });

  it("aucune suppression : aucune fonction de suppression n'est exposée", () => {
    expect(Object.keys(regles).some((k) => /suppr/i.test(k))).toBe(false);
  });
});

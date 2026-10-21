import { describe, expect, it } from "vitest";

import {
  categorisationObligatoireAu,
  libelleRegleCategorisation,
  MESSAGE_DEMANDE_SANS_CATEGORIE,
  refusDemandeSansCategorie,
  refusLignesValideesSansCategorie,
  validerDateCategorisation,
} from "./categorisationObligatoire";

const lignes = [
  { id: "a", libelle: "Transport", categorieId: "cat1" },
  { id: "b", libelle: "Matériel", categorieId: null },
  { id: "c", libelle: "Repas", categorieId: null },
];

describe("refusLignesValideesSansCategorie", () => {
  it("accepte une ligne validée catégorisée", () => {
    expect(refusLignesValideesSansCategorie([{ ligneId: "a", statut: "VALIDEE" }], lignes, true)).toBeNull();
  });

  it("refuse une ligne validée sans catégorie et la nomme", () => {
    const m = refusLignesValideesSansCategorie(
      [
        { ligneId: "a", statut: "VALIDEE" },
        { ligneId: "b", statut: "VALIDEE" },
      ],
      lignes,
      true
    );
    expect(m).toContain("« Matériel »");
    expect(m).not.toContain("Transport");
  });

  it("n'exige rien d'une ligne rejetée", () => {
    expect(
      refusLignesValideesSansCategorie(
        [
          { ligneId: "a", statut: "VALIDEE" },
          { ligneId: "b", statut: "REJETEE" },
          { ligneId: "c", statut: "REJETEE" },
        ],
        lignes,
        true
      )
    ).toBeNull();
  });

  it("toutes rejetées sans catégorie : accepté (renvoi en correction)", () => {
    expect(
      refusLignesValideesSansCategorie(
        [
          { ligneId: "b", statut: "REJETEE" },
          { ligneId: "c", statut: "REJETEE" },
        ],
        lignes,
        true
      )
    ).toBeNull();
  });

  it("plusieurs lignes en cause : message au pluriel avec chacune", () => {
    const m = refusLignesValideesSansCategorie(
      [
        { ligneId: "b", statut: "VALIDEE" },
        { ligneId: "c", statut: "VALIDEE" },
      ],
      lignes,
      true
    );
    expect(m).toMatch(/^Les lignes/);
    expect(m).toContain("« Matériel »");
    expect(m).toContain("« Repas »");
  });
});

describe("refusDemandeSansCategorie", () => {
  it("refuse une dépense directe sans catégorie", () => {
    expect(refusDemandeSansCategorie({ categorieId: null }, true)).toBe(MESSAGE_DEMANDE_SANS_CATEGORIE);
  });
  it("accepte une dépense directe catégorisée", () => {
    expect(refusDemandeSansCategorie({ categorieId: "cat1" }, true)).toBeNull();
  });
});

describe("date à partir de laquelle la catégorisation est obligatoire (lot I)", () => {
  const avant = new Date("2026-10-31T12:00:00.000Z");
  const jour = new Date("2026-11-01T00:30:00.000Z");
  const apres = new Date("2026-11-15T09:00:00.000Z");

  it("date nulle ou invalide : jamais obligatoire", () => {
    expect(categorisationObligatoireAu(null, apres)).toBe(false);
    expect(categorisationObligatoireAu(undefined, apres)).toBe(false);
    expect(categorisationObligatoireAu("pas une date", apres)).toBe(false);
  });
  it("avant la date : pas obligatoire", () => {
    expect(categorisationObligatoireAu("2026-11-01", avant)).toBe(false);
    expect(categorisationObligatoireAu(new Date("2026-11-01T00:00:00.000Z"), avant)).toBe(false);
  });
  it("le jour même (inclus) et après : obligatoire, comparaison au jour près", () => {
    expect(categorisationObligatoireAu("2026-11-01", jour)).toBe(true);
    expect(categorisationObligatoireAu("2026-11-01", apres)).toBe(true);
  });

  it("avant la date ou sans date : une ligne validée sans catégorie passe", () => {
    const decisions = [{ ligneId: "b", statut: "VALIDEE" as const }];
    expect(refusLignesValideesSansCategorie(decisions, lignes, categorisationObligatoireAu(null, apres))).toBeNull();
    expect(refusLignesValideesSansCategorie(decisions, lignes, categorisationObligatoireAu("2026-11-01", avant))).toBeNull();
  });
  it("à partir de la date : le blocage d'origine s'applique", () => {
    const decisions = [{ ligneId: "b", statut: "VALIDEE" as const }];
    expect(refusLignesValideesSansCategorie(decisions, lignes, categorisationObligatoireAu("2026-11-01", apres))).toContain("« Matériel »");
  });
  it("même règle pour une dépense directe", () => {
    expect(refusDemandeSansCategorie({ categorieId: null }, categorisationObligatoireAu(null, apres))).toBeNull();
    expect(refusDemandeSansCategorie({ categorieId: null }, categorisationObligatoireAu("2026-11-01", avant))).toBeNull();
    expect(refusDemandeSansCategorie({ categorieId: null }, categorisationObligatoireAu("2026-11-01", apres))).toBe(MESSAGE_DEMANDE_SANS_CATEGORIE);
  });

  it("validerDateCategorisation : vide = jamais, jour valide accepté, le reste refusé", () => {
    expect(validerDateCategorisation("")).toEqual({ ok: true, date: null });
    expect(validerDateCategorisation(null)).toEqual({ ok: true, date: null });
    expect(validerDateCategorisation("2026-11-01")).toEqual({ ok: true, date: "2026-11-01" });
    expect(validerDateCategorisation("2026-02-30").ok).toBe(false);
    expect(validerDateCategorisation("01/11/2026").ok).toBe(false);
  });
  it("libellé de la règle", () => {
    expect(libelleRegleCategorisation(null, apres)).toContain("pas obligatoire");
    expect(libelleRegleCategorisation("2026-11-01", avant)).toContain("deviendra obligatoire");
    expect(libelleRegleCategorisation("2026-11-01", apres)).toContain("obligatoire pour valider depuis le 01/11/2026");
  });
});

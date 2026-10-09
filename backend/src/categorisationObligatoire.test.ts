import { describe, expect, it } from "vitest";

import {
  MESSAGE_DEMANDE_SANS_CATEGORIE,
  refusDemandeSansCategorie,
  refusLignesValideesSansCategorie,
} from "./categorisationObligatoire";

const lignes = [
  { id: "a", libelle: "Transport", categorieId: "cat1" },
  { id: "b", libelle: "Matériel", categorieId: null },
  { id: "c", libelle: "Repas", categorieId: null },
];

describe("refusLignesValideesSansCategorie", () => {
  it("accepte une ligne validée catégorisée", () => {
    expect(refusLignesValideesSansCategorie([{ ligneId: "a", statut: "VALIDEE" }], lignes)).toBeNull();
  });

  it("refuse une ligne validée sans catégorie et la nomme", () => {
    const m = refusLignesValideesSansCategorie(
      [
        { ligneId: "a", statut: "VALIDEE" },
        { ligneId: "b", statut: "VALIDEE" },
      ],
      lignes
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
        lignes
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
        lignes
      )
    ).toBeNull();
  });

  it("plusieurs lignes en cause : message au pluriel avec chacune", () => {
    const m = refusLignesValideesSansCategorie(
      [
        { ligneId: "b", statut: "VALIDEE" },
        { ligneId: "c", statut: "VALIDEE" },
      ],
      lignes
    );
    expect(m).toMatch(/^Les lignes/);
    expect(m).toContain("« Matériel »");
    expect(m).toContain("« Repas »");
  });
});

describe("refusDemandeSansCategorie", () => {
  it("refuse une dépense directe sans catégorie", () => {
    expect(refusDemandeSansCategorie({ categorieId: null })).toBe(MESSAGE_DEMANDE_SANS_CATEGORIE);
  });
  it("accepte une dépense directe catégorisée", () => {
    expect(refusDemandeSansCategorie({ categorieId: "cat1" })).toBeNull();
  });
});

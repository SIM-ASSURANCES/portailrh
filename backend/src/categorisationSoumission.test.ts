import { describe, expect, it } from "vitest";

import { raisonLigneNonSoumettable, versLigneCircuit } from "./circuitDemande";

const ligne = (categorieId: string | null) => ({
  id: "l1",
  libelle: "Matériel",
  categorieId,
  statutValidation: "EN_ATTENTE" as const,
  soumiseAuDG: false,
  decisionDG: null,
  decisionDGParId: null,
  beneficiaireType: null,
  beneficiaireUserId: null,
  beneficiaireNom: null,
});

describe("soumission au DG et catégorisation obligatoire (lot I)", () => {
  it("obligatoire (défaut) : un article sans catégorie ne peut pas être soumis au DG", () => {
    expect(raisonLigneNonSoumettable(versLigneCircuit(ligne(null)))).toContain("Catégorisez");
    expect(raisonLigneNonSoumettable(versLigneCircuit(ligne(null), undefined, true))).toContain("Catégorisez");
  });
  it("non obligatoire : la soumission au DG ne bloque pas sur la catégorie", () => {
    expect(raisonLigneNonSoumettable(versLigneCircuit(ligne(null), undefined, false))).toBeNull();
  });
  it("catégorisé : jamais de blocage, quelle que soit la règle", () => {
    expect(raisonLigneNonSoumettable(versLigneCircuit(ligne("cat"), undefined, true))).toBeNull();
    expect(raisonLigneNonSoumettable(versLigneCircuit(ligne("cat"), undefined, false))).toBeNull();
  });
});

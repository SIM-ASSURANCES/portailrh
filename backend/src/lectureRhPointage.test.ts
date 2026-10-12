import { describe, expect, it } from "vitest";

import { justificationAffichee } from "./justificationPointage";
import { utilisateursCouvertsParAbsence } from "./pointage-utils";

// Pointage V2, lot 7 : ce que lisent la présence du jour, le reporting et l'export.
describe("justificationAffichee", () => {
  it("statut réel, motif de la justification, décidée par (acceptée ou refusée)", () => {
    expect(
      justificationAffichee({ motif: null, justification: { statut: "ACCEPTEE", motif: "Embouteillage", decideur: { fullName: "Resp" } } })
    ).toEqual({ statut: "ACCEPTEE", libelle: "Justification acceptée", motif: "Embouteillage", decideePar: "Resp" });
    expect(justificationAffichee({ motif: null, justification: { statut: "REFUSEE", motif: "Panne", decideur: { fullName: "RH" } } }).decideePar).toBe("RH");
  });
  it("pas encore décidée : jamais d'auteur de décision", () => {
    for (const statut of ["EN_ATTENTE", "SOUMISE", "NON_JUSTIFIEE"] as const) {
      expect(justificationAffichee({ motif: null, justification: { statut, motif: null, decideur: null } }).decideePar).toBeNull();
    }
    expect(justificationAffichee({ motif: null, justification: { statut: "EN_ATTENTE", motif: null, decideur: null } }).libelle).not.toBe("—");
  });
  it("repli sur l'ancien motif du pointage (historique antérieur au lot 3)", () => {
    expect(justificationAffichee({ motif: "Ancien motif", justification: null })).toEqual({
      statut: null,
      libelle: "—",
      motif: "Ancien motif",
      decideePar: null,
    });
    expect(justificationAffichee({ motif: "Ancien", justification: { statut: "EN_ATTENTE", motif: null, decideur: null } }).motif).toBe("Ancien");
  });
});

describe("utilisateursCouvertsParAbsence", () => {
  const horaires = { heureDebutMatin: "07:45", heureFinApresMidi: "16:45" };
  it("journée entière couverte (congé, ou plages qui se rejoignent) : absence autorisée", () => {
    const couverts = utilisateursCouvertsParAbsence(
      [
        { userId: "conge", heureDebut: "00:00", heureFin: "23:59" },
        { userId: "deux", heureDebut: "07:00", heureFin: "12:00" },
        { userId: "deux", heureDebut: "12:00", heureFin: "17:00" },
        { userId: "matin", heureDebut: "07:45", heureFin: "10:00" },
      ],
      horaires
    );
    expect([...couverts].sort()).toEqual(["conge", "deux"]);
  });
  it("permission partielle : pas une absence autorisée pour la journée", () => {
    expect(utilisateursCouvertsParAbsence([{ userId: "a", heureDebut: "13:00", heureFin: "16:00" }], horaires).size).toBe(0);
  });
});

import { describe, expect, it } from "vitest";

import { corrigerDemande, type DemandeARecalculer } from "./repriseArticles";

const ligne = (statutValidation: "EN_ATTENTE" | "VALIDEE" | "REJETEE", extra: Partial<DemandeARecalculer["lignes"][number]> = {}) => ({
  quantite: 1,
  prixUnitaire: "1000",
  statutValidation,
  soumiseAuDG: false,
  decisionDG: null,
  ...extra,
});
const demande = (p: Partial<DemandeARecalculer> = {}): DemandeARecalculer => ({
  id: "d1",
  reference: "DEM-2026-000001",
  typeDemande: "STANDARD",
  statut: "PARTIELLEMENT_VALIDEE",
  etapeCircuit: "TERMINEE",
  modeEtapeDG: "OPTIONNELLE",
  montant: 3000,
  montantValide: 2000,
  totalRegle: 2000,
  lignes: [ligne("VALIDEE"), ligne("VALIDEE"), ligne("REJETEE")],
  ...p,
});

describe("reprise : recalcul du statut des demandes existantes", () => {
  it("demande réglée avec un article rejeté : « Partiellement validée » devient « Réglée »", () => {
    const c = corrigerDemande(demande())!;
    expect(c.changements).toEqual({ statut: "REGLEE" });
    expect(c.resume).toEqual(["statut : PARTIELLEMENT_VALIDEE → REGLEE"]);
  });

  it("idempotent : une fois corrigée, un second passage ne trouve rien", () => {
    expect(corrigerDemande(demande({ statut: "REGLEE" }))).toBeNull();
  });

  it("ancienne étape (rejet DG, décision finale) déduite des articles", () => {
    const c = corrigerDemande(
      demande({
        statut: "EN_ATTENTE_VALIDATION",
        etapeCircuit: "DECISION_FINALE",
        montantValide: 0,
        totalRegle: 0,
        lignes: [ligne("EN_ATTENTE", { soumiseAuDG: true, decisionDG: "VALIDEE" }), ligne("EN_ATTENTE")],
      })
    )!;
    expect(c.changements).toEqual({ etapeCircuit: "FINANCE" });
  });

  it("montant validé resynchronisé sur la somme des articles validés", () => {
    const c = corrigerDemande(demande({ statut: "REGLEE", montantValide: 3000 }))!;
    expect(c.changements).toEqual({ montantValide: 2000 });
  });

  it("demandes terminales, dépense directe et demandes sans article : jamais touchées", () => {
    expect(corrigerDemande(demande({ statut: "CLOTUREE", montantValide: 3000 }))).toEqual(
      expect.objectContaining({ changements: { montantValide: 2000 } })
    );
    expect(corrigerDemande(demande({ typeDemande: "DEPENSE_DIRECTE" }))).toBeNull();
    expect(corrigerDemande(demande({ lignes: [] }))).toBeNull();
  });

  it("une demande clôturée ne change ni de statut ni d'étape", () => {
    const c = corrigerDemande(demande({ statut: "CLOTUREE", etapeCircuit: "FINANCE", montantValide: 2000 }));
    expect(c).toBeNull();
  });

  it("étapes explicites (Service, à corriger) conservées", () => {
    expect(
      corrigerDemande(demande({ statut: "EN_ATTENTE_VALIDATION", etapeCircuit: "SERVICE", montantValide: 0, totalRegle: 0, lignes: [ligne("EN_ATTENTE")] }))
    ).toBeNull();
  });
});

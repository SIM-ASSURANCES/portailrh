import { describe, expect, it } from "vitest";

import {
  COLONNES_REPORTING_DEMANDE,
  construireLigneReporting,
  libelleValidation,
  type DemandeReportingSource,
} from "./reportingDemandeLigne";

const d = (j: number) => new Date(Date.UTC(2026, 9, j, 9, 0));

function demande(partiel: Partial<DemandeReportingSource> = {}): DemandeReportingSource {
  return {
    reference: "DEM-2026-000001",
    creeLe: d(1),
    typeDemande: "STANDARD",
    statut: "Réglée",
    etapeCircuit: "Terminée",
    demandeur: "Collab Test",
    service: "Commercial",
    beneficiaire: "Collab Test",
    description: null,
    categorie: null,
    objet: null,
    montantDemande: 30000,
    montantValide: 20000,
    lignes: [
      {
        libelle: "Transport",
        motif: "Livraison client",
        quantite: 2,
        prixUnitaire: 10000,
        categorie: "Déplacements",
        objet: "Taxi",
        statut: "VALIDEE",
        motifRejet: null,
        decidePar: "Finance Test",
        decideLe: d(2),
      },
      {
        libelle: "Repas",
        motif: "Réunion",
        quantite: 1,
        prixUnitaire: 10000,
        categorie: null,
        objet: null,
        statut: "REJETEE",
        motifRejet: "Hors budget",
        decidePar: "Finance Test",
        decideLe: d(2),
      },
    ],
    reglements: [],
    retoursExceptionnels: [],
    historique: [],
    ...partiel,
  };
}

describe("construireLigneReporting", () => {
  it("une cellule par donnée multiple, un élément par ligne d'article", () => {
    const l = construireLigneReporting(demande());
    expect(l.lignesArticles).toHaveLength(2);
    expect(l.lignesArticles[0]).toContain("Transport");
    expect(l.lignesArticles[0]).toContain("motif : Livraison client");
    expect(l.lignesArticles[0]).toContain("Déplacements / Taxi");
    expect(l.lignesArticles[0]).toContain("Validée par Finance Test");
    expect(l.lignesArticles[1]).toContain("sans catégorie");
    expect(l.lignesArticles[1]).toContain("Rejetée (Hors budget)");
  });

  it("totaux : réglé hors brouillons et annulés, retourné net des remboursements validés, solde = réglé − dépensé − retourné", () => {
    const l = construireLigneReporting(
      demande({
        reglements: [
          {
            montant: 20000,
            mode: "CAISSE",
            estConfirme: true,
            estAnnule: false,
            motifAnnulation: null,
            auteur: "Assistant",
            creeLe: d(3),
            confirmeLe: d(3),
            retours: [
              {
                montantARetourner: 5000,
                estReceptionne: true,
                receptionneLe: d(5),
                receptionnePar: "Assistant",
                declarant: "Collab Test",
                declareLe: d(4),
                creeParAssistant: false,
                complementSignalement: false,
                reouvertureExceptionnelle: false,
                depenses: [
                  { libelle: "Taxi aller", montant: 10000, justifiee: true, motifNonJustifie: null },
                  { libelle: "Taxi retour", montant: 5000, justifiee: false, motifNonJustifie: "Pas de reçu" },
                ],
                remboursements: [
                  {
                    montant: 1000,
                    statut: "VALIDE",
                    proposePar: "Assistant",
                    proposeLe: d(6),
                    validePar: "Finance Test",
                    valideLe: d(7),
                    motifRejet: null,
                  },
                ],
              },
            ],
          },
          { montant: 7000, mode: "BANQUE", estConfirme: true, estAnnule: true, motifAnnulation: "Erreur", auteur: "Assistant", creeLe: d(3), confirmeLe: d(3), retours: [] },
          { montant: 3000, mode: "BANQUE", estConfirme: false, estAnnule: false, motifAnnulation: null, auteur: "Assistant", creeLe: d(3), confirmeLe: null, retours: [] },
        ],
        retoursExceptionnels: [
          { montant: 500, statut: "VALIDE", saisiPar: "Assistant", saisiLe: d(8), validePar: "Finance Test", valideLe: d(9), motifRejet: null },
          { montant: 900, statut: "REJETE", saisiPar: "Assistant", saisiLe: d(8), validePar: "Finance Test", valideLe: d(9), motifRejet: "Doublon" },
        ],
      })
    );
    expect(l.totalRegle).toBe(20000);
    expect(l.totalDepense).toBe(15000);
    expect(l.totalDepenseJustifiee).toBe(10000);
    expect(l.totalRetourne).toBe(5000 - 1000 + 500);
    expect(l.solde).toBe(20000 - 15000 - 4500);
    expect(l.reglements).toHaveLength(3);
    expect(l.reglements[1]).toMatch(/^Annulé/);
    expect(l.reglements[2]).toMatch(/^Brouillon/);
    expect(l.depenses[1]).toContain("non justifiée (Pas de reçu)");
    expect(l.remboursements[0]).toContain("validé par Finance Test");
    expect(l.ajustements).toHaveLength(2);
    expect(l.ajustements[1]).toContain("rejeté");
  });

  it("retour nul : constaté, sans montant rendu", () => {
    const l = construireLigneReporting(
      demande({
        reglements: [
          {
            montant: 20000,
            mode: "CAISSE",
            estConfirme: true,
            estAnnule: false,
            motifAnnulation: null,
            auteur: "Assistant",
            creeLe: d(3),
            confirmeLe: d(3),
            retours: [
              {
                montantARetourner: 0,
                estReceptionne: true,
                receptionneLe: d(5),
                receptionnePar: "Assistant 2",
                declarant: "Assistant 2",
                declareLe: d(4),
                creeParAssistant: true,
                complementSignalement: false,
                reouvertureExceptionnelle: false,
                depenses: [{ libelle: "Fournitures", montant: 20000, justifiee: true, motifNonJustifie: null }],
                remboursements: [],
              },
            ],
          },
        ],
      })
    );
    expect(l.retours[0]).toContain("Retour nul constaté par Assistant 2");
    expect(l.solde).toBe(0);
  });

  it("validations Service, Finance, DG avec auteur et date ; ajustement du total déclaré", () => {
    const l = construireLigneReporting(
      demande({
        historique: [
          { action: "CREATE", detail: null, auteur: "Collab Test", date: d(1) },
          { action: "validation_service", detail: "Service → Finance", auteur: "Resp Com", date: d(2) },
          { action: "soumission_dg", detail: "Finance → DG", auteur: "Finance Test", date: d(3) },
          { action: "validation_dg", detail: "DG → Décision finale — vaut approbation de clôture du DG", auteur: "DG Test", date: d(4) },
          { action: "decision_circuit", detail: "Décision finale → Terminée", auteur: "Finance Test", date: d(5) },
          { action: "ajustement_total_retour", detail: "Total ajusté : 10 → 12 FCFA", auteur: "Finance Test", date: d(6) },
        ],
      })
    );
    expect(l.validations).toEqual([
      "Service — validée — Resp Com, 02/10/2026",
      "Finance — soumise au DG — Finance Test, 03/10/2026",
      "DG — validée — DG Test, 04/10/2026",
      "Finance — décision sur les lignes — Finance Test, 05/10/2026",
    ]);
    expect(l.ajustements[0]).toContain("Ajustement du total déclaré");
  });

  it("dépense directe sans ligne : description et catégorie", () => {
    const l = construireLigneReporting(
      demande({ typeDemande: "DEPENSE_DIRECTE", lignes: [], description: "Prime de stage", categorie: "RH", objet: "Primes" })
    );
    expect(l.type).toBe("Dépense directe");
    expect(l.lignesArticles).toEqual(["Dépense directe — Prime de stage — 30 000 FCFA — RH / Primes"]);
  });
});

describe("libelleValidation", () => {
  it("décision du DG sur les lignes (cas b)", () => {
    expect(libelleValidation("decision_circuit", "DG → Terminée — vaut approbation de clôture du DG")?.niveau).toBe("DG");
  });
  it("renvoi en correction : niveau lu dans le détail", () => {
    expect(libelleValidation("renvoi_correction", "Service → À corriger — niveau Service — motif : x")?.niveau).toBe("Service");
  });
  it("action hors validation : ignorée", () => {
    expect(libelleValidation("reglement", null)).toBeNull();
  });
});

describe("COLONNES_REPORTING_DEMANDE", () => {
  it("date de création juste à côté de la référence, bénéficiaire présent", () => {
    const cles = COLONNES_REPORTING_DEMANDE.map((c) => c.cle);
    expect(cles.indexOf("creeLe")).toBe(cles.indexOf("reference") + 1);
    expect(cles).toContain("beneficiaire");
  });
});

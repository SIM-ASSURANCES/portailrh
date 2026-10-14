import { describe, expect, it } from "vitest";

import { construireLigneRetour, COLONNES_REPORTING_RETOUR, type SourceRetourReporting } from "./reportingRetourCaisse";
import { etatTotalRecap } from "./recapRetourCaisseDb";

const source = (o: Partial<SourceRetourReporting> = {}): SourceRetourReporting => ({
  retourId: "t1",
  declareLe: new Date("2026-10-20T10:00:00Z"),
  declarant: "Collaborateur Test",
  creeParAssistant: false,
  estReceptionne: true,
  receptionneLe: new Date("2026-10-21T10:00:00Z"),
  receptionnePar: "Assistant Test",
  versementBancaire: false,
  montantARetourner: 10000,
  totalDepenses: 90000,
  reglement: { mode: "BANQUE", montant: 40000, confirmeLe: new Date("2026-10-19T10:00:00Z") },
  demande: { reference: "DEM-2026-000001", demandeur: "Collaborateur Test", service: "Commercial" },
  article: { libelleFinance: "Ordinateur (Finance)", libelleDemandeur: "Ordinateur", beneficiaire: "Bob", montantValide: 100000, dateLivraison: new Date("2026-10-30T00:00:00Z") },
  reglementsArticle: [
    { mode: "CAISSE", montant: 60000, date: new Date("2026-10-18T10:00:00Z") },
    { mode: "BANQUE", montant: 40000, date: new Date("2026-10-19T10:00:00Z") },
  ],
  ...o,
});

describe("reporting des retours de caisse (lot G.5)", () => {
  it("détail de l'article d'origine, règlements Caisse et Banque, demande", () => {
    const l = construireLigneRetour(source());
    expect(l).toMatchObject({
      demande: "DEM-2026-000001",
      demandeur: "Collaborateur Test",
      service: "Commercial",
      article: "Ordinateur (Finance)",
      articleDemandeur: "Ordinateur",
      beneficiaire: "Bob",
      montantValideArticle: 100000,
      dateLivraison: "30/10/2026",
      totalRegleArticle: 100000,
      dontCaisse: 60000,
      dontBanque: 40000,
      modeReglement: "Banque",
      nature: "Espèces à la caisse",
      etat: "Réceptionné",
    });
    expect(l.reglementsArticle).toHaveLength(2);
    expect(l.reglementsArticle[0]).toMatch(/^Caisse — 60 000 FCFA/);
    expect(l.reglementsArticle[1]).toMatch(/^Banque — 40 000 FCFA/);
  });
  it("retour nul, en attente, ancien versement bancaire, retour d'un règlement sans article", () => {
    expect(construireLigneRetour(source({ montantARetourner: 0 })).etat).toBe("Retour nul");
    expect(construireLigneRetour(source({ estReceptionne: false, receptionneLe: null, receptionnePar: null })).etat).toBe("En attente de réception");
    const ancien = construireLigneRetour(source({ montantARetourner: 0, versementBancaire: true }));
    expect(ancien.etat).toBe("Réceptionné");
    expect(ancien.nature).toMatch(/Versement bancaire/);
    const sans = construireLigneRetour(source({ article: null }));
    expect(sans.dateLivraison).toBe("—");
    expect(sans.montantValideArticle).toBeNull();
  });
  it("article antérieur sans date de livraison : « — »", () => {
    expect(construireLigneRetour(source({ article: { ...source().article!, dateLivraison: null } })).dateLivraison).toBe("—");
  });
  it("toutes les colonnes ont une valeur dans la ligne", () => {
    const l = construireLigneRetour(source());
    for (const c of COLONNES_REPORTING_RETOUR) expect(c.cle in l).toBe(true);
  });
});

describe("état du total du récapitulatif collaborateur", () => {
  const ag = (p: Partial<{ fondsRemis: number; depensesJustifiees: number; retoursRecus: number }>) => ({
    fondsRemis: 0,
    depensesJustifiees: 0,
    depensesSansPieceFormelle: 0,
    resteNonDetaille: 0,
    retoursRecus: 0,
    retoursEnAttente: 0,
    ...p,
  });
  it("aucun fonds, à régulariser, régularisé, anomalie", () => {
    expect(etatTotalRecap(ag({}))).toBe("ATTENTE_REGLEMENT");
    expect(etatTotalRecap(ag({ fondsRemis: 100000, depensesJustifiees: 40000 }))).toBe("A_REGULARISER");
    expect(etatTotalRecap(ag({ fondsRemis: 100000, depensesJustifiees: 60000, retoursRecus: 40000 }))).toBe("REGULARISE");
    expect(etatTotalRecap(ag({ fondsRemis: 100000, depensesJustifiees: 120000 }))).toBe("ANOMALIE");
  });
});

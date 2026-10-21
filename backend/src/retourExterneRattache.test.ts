import { describe, expect, it } from "vitest";

import {
  MESSAGE_ARTICLE_ETRANGER,
  MESSAGE_ARTICLE_INTERDIT,
  MESSAGE_ARTICLE_REQUIS,
  MESSAGE_SANS_REGLEMENT_BANQUE,
  plafondRetourRattache,
  refusRetourRattache,
  type ContexteRattachement,
} from "./retourExterneRattache";
import { agregerRegularisation, getEcartLigne } from "./regularisationArticle";

const ctx = (p: Partial<ContexteRattachement> = {}): ContexteRattachement => ({
  demandeALignes: true,
  ligneDemandeId: "a",
  ligneAppartientALaDemande: true,
  fondsBanque: 40000,
  dejaRetourneExterne: 0,
  ecartPerimetre: 100000,
  ...p,
});

describe("rattachement d'un retour externe à une demande et un article", () => {
  it("accepte un retour dans le plafond des fonds versés par banque", () => {
    expect(refusRetourRattache(ctx(), 40000)).toBeNull();
    expect(refusRetourRattache(ctx(), 15000)).toBeNull();
  });

  it("exige l'article d'une demande à articles, l'interdit sans article, refuse un article étranger", () => {
    expect(refusRetourRattache(ctx({ ligneDemandeId: null }), 1000)).toBe(MESSAGE_ARTICLE_REQUIS);
    expect(refusRetourRattache(ctx({ ligneAppartientALaDemande: false }), 1000)).toBe(MESSAGE_ARTICLE_ETRANGER);
    expect(refusRetourRattache(ctx({ demandeALignes: false }), 1000)).toBe(MESSAGE_ARTICLE_INTERDIT);
    expect(refusRetourRattache(ctx({ demandeALignes: false, ligneDemandeId: null }), 1000)).toBeNull();
  });

  it("refuse sans règlement par banque confirmé sur l'article", () => {
    expect(refusRetourRattache(ctx({ fondsBanque: 0 }), 1000)).toBe(MESSAGE_SANS_REGLEMENT_BANQUE);
  });

  it("plafonne aux fonds banque non encore retournés, puis au solde à régulariser", () => {
    expect(plafondRetourRattache(ctx({ dejaRetourneExterne: 25000 }))).toBe(15000);
    expect(refusRetourRattache(ctx({ dejaRetourneExterne: 25000 }), 15001)).toContain("dépasse le maximum");
    expect(plafondRetourRattache(ctx({ ecartPerimetre: 10000 }))).toBe(10000);
    expect(refusRetourRattache(ctx({ ecartPerimetre: 10000 }), 10000)).toBeNull();
    expect(refusRetourRattache(ctx({ ecartPerimetre: 10000 }), 10000.01)).toContain("dépasse le maximum");
  });

  it("plus rien à retourner : message dédié, plafond nul, jamais négatif", () => {
    expect(plafondRetourRattache(ctx({ dejaRetourneExterne: 40000 }))).toBe(0);
    expect(plafondRetourRattache(ctx({ ecartPerimetre: -500 }))).toBe(0);
    expect(refusRetourRattache(ctx({ dejaRetourneExterne: 40000 }), 1)).toContain("plus rien à retourner");
  });
});

describe("un retour externe rattaché compte comme retour reçu de l'article", () => {
  // Article de 100 000 : 60 000 Caisse + 40 000 Banque ; 25 000 de dépenses ; 15 000 revenus par retour externe.
  const base = {
    reglements: [
      { id: "r1", ligneDemandeId: "a", montant: 60000, estConfirme: true, estAnnule: false },
      { id: "r2", ligneDemandeId: "a", montant: 40000, estConfirme: true, estAnnule: false },
    ],
    retours: [
      {
        reglementId: "r2",
        estReceptionne: false,
        montantARetourner: 15000,
        depenses: [{ montant: 25000, justification: "FACTURE" as const, objet: "Achat", motifNonJustifie: null }],
      },
    ],
    remboursements: [],
  };

  it("le solde de l'article baisse du montant du retour externe, la fiche non réceptionnée ne compte pas", () => {
    const sans = agregerRegularisation({ ...base, exceptionnels: [] });
    expect(getEcartLigne(sans.parArticle.get("a")!)).toBe(75000);
    const avec = agregerRegularisation({ ...base, exceptionnels: [{ ligneDemandeId: "a", montant: 15000 }] });
    expect(avec.parArticle.get("a")!.retoursRecus).toBe(15000);
    expect(getEcartLigne(avec.parArticle.get("a")!)).toBe(60000);
    expect(getEcartLigne(avec.total)).toBe(60000);
  });
});

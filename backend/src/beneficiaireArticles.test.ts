import { describe, expect, it } from "vitest";

import {
  aPlusieursBeneficiaires,
  appliquerATous,
  beneficiaireArticle,
  choixDepuisStocke,
  choixPropreArticle,
  comptesConcernesArticle,
  comptesConcernesDemande,
  detailsArticles,
  erreurSaisieBeneficiaire,
  estPersonnalise,
  ilYADesPersonnalisations,
  LIBELLE_PLUSIEURS_BENEFICIAIRES,
  nomBeneficiaireDemande,
  repartirPieces,
  SAISIE_BENEFICIAIRE_MOI,
  type SaisieBeneficiaire,
} from "./beneficiaireArticles";
import { refusExecutionPropreDemande, refusExecutionPropreReglement } from "./circuitDemande";

const demandeMoi = {
  createurId: "u-createur",
  beneficiaireType: "COLLABORATEUR" as const,
  beneficiaireUserId: "u-createur",
  beneficiaireNom: null,
  beneficiaireUser: { fullName: "Alice Créatrice" },
};
const ligneHerite = { id: "l1", beneficiaireType: null, beneficiaireUserId: null, beneficiaireNom: null };
const ligneFournisseur = {
  id: "l2",
  beneficiaireType: "FOURNISSEUR" as const,
  beneficiaireUserId: null,
  beneficiaireNom: "Papeterie Centrale",
};
const ligneBob = {
  id: "l3",
  beneficiaireType: "COLLABORATEUR" as const,
  beneficiaireUserId: "u-bob",
  beneficiaireNom: null,
  beneficiaireUser: { fullName: "Bob" },
};

describe("bénéficiaire par article — héritage", () => {
  it("un article sans bénéficiaire propre hérite de celui de la demande", () => {
    const b = beneficiaireArticle(ligneHerite, demandeMoi);
    expect(b.libelle).toBe("Alice Créatrice");
    expect(b.propre).toBe(false);
  });

  it("un article avec bénéficiaire propre garde le sien", () => {
    const b = beneficiaireArticle(ligneFournisseur, demandeMoi);
    expect(b.libelle).toBe("Papeterie Centrale");
    expect(b.propre).toBe(true);
  });

  it("les demandes existantes (aucun article personnalisé) n'ont qu'un bénéficiaire", () => {
    expect(aPlusieursBeneficiaires(demandeMoi, [ligneHerite, { ...ligneHerite, id: "x" }])).toBe(false);
    expect(nomBeneficiaireDemande(demandeMoi, [ligneHerite])).toBe("Alice Créatrice");
  });

  it("une demande sans article (dépense directe) garde son bénéficiaire", () => {
    expect(nomBeneficiaireDemande(demandeMoi, [])).toBe("Alice Créatrice");
  });
});

describe("plusieurs bénéficiaires", () => {
  it("affiche « Plusieurs bénéficiaires » quand les articles diffèrent", () => {
    expect(nomBeneficiaireDemande(demandeMoi, [ligneHerite, ligneFournisseur])).toBe(LIBELLE_PLUSIEURS_BENEFICIAIRES);
  });

  it("un article dont le bénéficiaire est le même compte que la demande ne compte pas pour un autre", () => {
    const memeCompte = { ...ligneHerite, id: "l9", beneficiaireType: "COLLABORATEUR" as const, beneficiaireUserId: "u-createur" };
    expect(aPlusieursBeneficiaires(demandeMoi, [ligneHerite, memeCompte])).toBe(false);
  });

  it("deux noms libres identiques à la casse et aux accents près sont le même bénéficiaire", () => {
    const a = { ...ligneFournisseur, id: "a", beneficiaireNom: "Café Zoé" };
    const b = { ...ligneFournisseur, id: "b", beneficiaireNom: "cafe zoe" };
    expect(aPlusieursBeneficiaires(demandeMoi, [a, b])).toBe(false);
  });
});

describe("garde 8 — conflit d'intérêts sur les bénéficiaires d'articles", () => {
  it("bloque le créateur, le bénéficiaire de la demande et le bénéficiaire de n'importe quel article", () => {
    const demande = { ...demandeMoi, lignes: [ligneHerite, ligneBob] };
    expect(refusExecutionPropreDemande(demande, "u-createur")).not.toBeNull();
    expect(refusExecutionPropreDemande(demande, "u-bob")).not.toBeNull();
    expect(refusExecutionPropreDemande(demande, "u-autre")).toBeNull();
  });

  it("lot D — par article : seuls le créateur et le bénéficiaire de CET article sont écartés", () => {
    const demande = { ...demandeMoi, lignes: [ligneHerite, ligneBob] };
    // L'article de Bob : Bob et le créateur sont bloqués, pas un tiers.
    expect(refusExecutionPropreReglement(demande, ligneBob, "u-bob")).not.toBeNull();
    expect(refusExecutionPropreReglement(demande, ligneBob, "u-createur")).not.toBeNull();
    expect(refusExecutionPropreReglement(demande, ligneBob, "u-autre")).toBeNull();
    // Bob peut en revanche exécuter l'article hérité (bénéficiaire = le créateur de la demande).
    expect(refusExecutionPropreReglement(demande, ligneHerite, "u-bob")).toBeNull();
    expect(refusExecutionPropreReglement(demande, ligneHerite, "u-createur")).not.toBeNull();
    // Sans article visé : la garde de la demande entière, inchangée.
    expect(refusExecutionPropreReglement(demande, null, "u-bob")).not.toBeNull();
    expect(comptesConcernesArticle(demandeMoi, ligneBob).sort()).toEqual(["u-bob", "u-createur"].sort());
  });

  it("comptesConcernesDemande liste le créateur et chaque bénéficiaire de compte, sans doublon", () => {
    expect(comptesConcernesDemande(demandeMoi, [ligneHerite, ligneBob, ligneFournisseur]).sort()).toEqual(
      ["u-bob", "u-createur"].sort()
    );
  });
});

describe("formulaire — « Appliquer à tous les articles »", () => {
  const commun: SaisieBeneficiaire = { mode: "COMPTE", userId: "u-bob", nom: "" };
  const articles = [
    { beneficiaire: null, pieces: [{ url: "a" }] },
    { beneficiaire: { mode: "NOM" as const, userId: "", nom: "Papeterie" }, pieces: [] },
    { beneficiaire: { mode: "COMPTE" as const, userId: "u-bob", nom: "" }, pieces: [] },
  ];

  it("repère les articles personnalisés (différents de la valeur commune)", () => {
    expect(estPersonnalise(articles[0], commun, "u-createur")).toBe(false);
    expect(estPersonnalise(articles[1], commun, "u-createur")).toBe(true);
    expect(estPersonnalise(articles[2], commun, "u-createur")).toBe(false); // égal à la valeur commune
    expect(ilYADesPersonnalisations(articles, commun, "u-createur")).toBe(true);
    expect(ilYADesPersonnalisations([articles[0], articles[2]], commun, "u-createur")).toBe(false);
  });

  it("appliquer à tous remet chaque article sur la valeur commune et garde ses pièces", () => {
    const apres = appliquerATous(articles);
    expect(apres.every((a) => a.beneficiaire === null)).toBe(true);
    expect(apres[0].pieces).toEqual([{ url: "a" }]);
  });

  it("« moi-même » et le compte du créateur désignent le même bénéficiaire", () => {
    expect(estPersonnalise({ beneficiaire: { mode: "COMPTE", userId: "u-createur", nom: "" }, pieces: [] }, SAISIE_BENEFICIAIRE_MOI, "u-createur")).toBe(false);
  });

  it("côté serveur, un article égal à la valeur commune n'enregistre rien", () => {
    const communChoix = { mode: "COMPTE" as const, userId: "u-bob" };
    expect(choixPropreArticle({ beneficiaire: { mode: "COMPTE", userId: "u-bob" } }, communChoix, "u-createur")).toBeNull();
    expect(choixPropreArticle({ beneficiaire: null }, communChoix, "u-createur")).toBeNull();
    expect(choixPropreArticle({ beneficiaire: { mode: "NOM", nom: "Papeterie" } }, communChoix, "u-createur")).toEqual({
      mode: "NOM",
      nom: "Papeterie",
    });
  });

  it("valide la saisie d'un bénéficiaire comme le serveur", () => {
    expect(erreurSaisieBeneficiaire({ mode: "COMPTE", userId: "", nom: "" })).toMatch(/compte/i);
    expect(erreurSaisieBeneficiaire({ mode: "NOM", userId: "", nom: "a" })).toMatch(/nom/i);
    expect(erreurSaisieBeneficiaire({ mode: "MOI", userId: "", nom: "" })).toBeNull();
  });
});

describe("pièces par article et affichage", () => {
  it("sépare la pièce commune des pièces propres à un article", () => {
    const { communes, parArticle } = repartirPieces([
      { id: "p1", ligneDemandeId: null },
      { id: "p2", ligneDemandeId: "l1" },
      { id: "p3", ligneDemandeId: "l1" },
      { id: "p4", ligneDemandeId: "l2" },
    ]);
    expect(communes.map((p) => p.id)).toEqual(["p1"]);
    expect(parArticle.get("l1")?.map((p) => p.id)).toEqual(["p2", "p3"]);
    expect(parArticle.get("l2")?.map((p) => p.id)).toEqual(["p4"]);
  });

  it("n'affiche le bénéficiaire sous chaque article que si l'un d'eux diffère de la demande", () => {
    expect(detailsArticles(demandeMoi, [ligneHerite], []).afficherBeneficiaire).toBe(false);
    expect(detailsArticles(demandeMoi, [ligneHerite, ligneFournisseur], []).afficherBeneficiaire).toBe(true);
  });

  it("rappelle la pièce commune sous les articles seulement quand il y a des détails propres", () => {
    const sans = detailsArticles(demandeMoi, [ligneHerite], [{ id: "p1", ligneDemandeId: null }]);
    expect(sans.detaille).toBe(false);
    const avec = detailsArticles(demandeMoi, [ligneHerite], [
      { id: "p1", ligneDemandeId: null },
      { id: "p2", ligneDemandeId: "l1" },
    ]);
    expect(avec.detaille).toBe(true);
    expect(avec.parArticle.get("l1")?.pieces.map((p) => p.id)).toEqual(["p2"]);
  });

  it("retrouve le choix à partir de ce qui est stocké", () => {
    expect(choixDepuisStocke(demandeMoi, "u-createur")).toEqual({ mode: "MOI" });
    expect(choixDepuisStocke(ligneBob, "u-createur")).toEqual({ mode: "COMPTE", userId: "u-bob" });
    expect(choixDepuisStocke(ligneFournisseur, "u-createur")).toEqual({ mode: "NOM", nom: "Papeterie Centrale" });
  });
});

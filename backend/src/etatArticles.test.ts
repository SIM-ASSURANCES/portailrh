import { describe, expect, it } from "vitest";

import {
  appliquerDecisionsSimulees,
  attendLaFinance,
  attendLeDG,
  compteurArticlesTraites,
  estTraite,
  etapeDepuisArticles,
  etatLigneCircuit,
  libelleEnCours,
  montantValideDepuisLignes,
  resumeArticles,
  statutDepuisLignes,
  totalArticle,
  type LigneEtat,
  type LigneMontant,
} from "./etatArticles";

// Lot B (2026-10-15) : état d'un article, étape et statut déduits des articles. Module pur.

const l = (p: Partial<LigneEtat> = {}): LigneEtat => ({ statut: "EN_ATTENTE", soumiseAuDG: false, decisionDG: null, ...p });
const m = (statut: LigneMontant["statut"], quantite = 1, prixUnitaire = 1000): LigneMontant => ({ statut, quantite, prixUnitaire });

describe("etatLigneCircuit", () => {
  it("article non soumis au DG : à décider par la Finance", () => {
    expect(etatLigneCircuit(l(), "OPTIONNELLE")).toBe("A_DECIDER");
    expect(etatLigneCircuit(l(), "NON_REQUISE")).toBe("A_DECIDER");
  });
  it("article soumis sans décision du DG : chez le DG", () => {
    expect(etatLigneCircuit(l({ soumiseAuDG: true }), "OPTIONNELLE")).toBe("CHEZ_DG");
  });
  it("validé par le DG : à confirmer par la Finance", () => {
    expect(etatLigneCircuit(l({ soumiseAuDG: true, decisionDG: "VALIDEE" }), "OPTIONNELLE")).toBe("VALIDEE_DG_A_CONFIRMER");
  });
  it("refusé par le DG : à trancher par la Finance (resoumettre ou rejeter)", () => {
    expect(etatLigneCircuit(l({ soumiseAuDG: true, decisionDG: "REFUSEE" }), "OPTIONNELLE")).toBe("REFUSEE_DG_A_TRANCHER");
  });
  it("validé et rejeté sont définitifs, quelle que soit la décision du DG", () => {
    expect(etatLigneCircuit(l({ statut: "VALIDEE", soumiseAuDG: true, decisionDG: "VALIDEE" }), "OPTIONNELLE")).toBe("VALIDEE");
    expect(etatLigneCircuit(l({ statut: "REJETEE", soumiseAuDG: true, decisionDG: "REFUSEE" }), "OPTIONNELLE")).toBe("REJETEE");
  });
  it("demande émise par la Finance (DG obligatoire) : tout article en attente est chez le DG", () => {
    expect(etatLigneCircuit(l(), "OBLIGATOIRE")).toBe("CHEZ_DG");
    expect(etatLigneCircuit(l({ statut: "VALIDEE" }), "OBLIGATOIRE")).toBe("VALIDEE");
  });
  it("qui l'attend : Finance, DG, ou personne (article traité)", () => {
    expect(attendLaFinance("A_DECIDER") && attendLaFinance("VALIDEE_DG_A_CONFIRMER") && attendLaFinance("REFUSEE_DG_A_TRANCHER")).toBe(true);
    expect(attendLaFinance("CHEZ_DG") || attendLaFinance("VALIDEE") || attendLaFinance("REJETEE")).toBe(false);
    expect(attendLeDG("CHEZ_DG")).toBe(true);
    expect(attendLeDG("A_DECIDER")).toBe(false);
    expect(estTraite("VALIDEE") && estTraite("REJETEE")).toBe(true);
    expect(estTraite("CHEZ_DG")).toBe(false);
  });
});

describe("resumeArticles", () => {
  it("compte chaque famille d'articles", () => {
    const r = resumeArticles(
      [
        l(),
        l({ soumiseAuDG: true }),
        l({ soumiseAuDG: true, decisionDG: "VALIDEE" }),
        l({ soumiseAuDG: true, decisionDG: "REFUSEE" }),
        l({ statut: "VALIDEE" }),
        l({ statut: "REJETEE" }),
      ],
      "OPTIONNELLE"
    );
    expect(r).toEqual({ total: 6, traites: 2, validees: 1, rejetees: 1, pourFinance: 3, valideesDGAConfirmer: 1, refuseesDGATrancher: 1, chezDG: 1 });
  });
});

describe("etapeDepuisArticles", () => {
  it("la Finance reste prioritaire tant qu'un article l'attend, même si le DG en a aussi", () => {
    expect(etapeDepuisArticles("DG", "OPTIONNELLE", [l(), l({ soumiseAuDG: true })])).toBe("FINANCE");
  });
  it("il ne reste que des articles chez le DG : étape DG", () => {
    expect(etapeDepuisArticles("FINANCE", "OPTIONNELLE", [l({ statut: "VALIDEE" }), l({ soumiseAuDG: true })])).toBe("DG");
  });
  it("tous traités avec au moins un validé : Terminée", () => {
    expect(etapeDepuisArticles("FINANCE", "OPTIONNELLE", [l({ statut: "VALIDEE" }), l({ statut: "REJETEE" })])).toBe("TERMINEE");
  });
  it("tous rejetés : la demande repart en correction", () => {
    expect(etapeDepuisArticles("FINANCE", "OPTIONNELLE", [l({ statut: "REJETEE" }), l({ statut: "REJETEE" })])).toBe("A_CORRIGER");
  });
  it("étapes posées explicitement par le circuit : Service, à corriger, abandonnée", () => {
    for (const e of ["SERVICE", "A_CORRIGER", "ABANDONNEE"] as const) expect(etapeDepuisArticles(e, "OPTIONNELLE", [l()])).toBe(e);
  });
  it("sans article (dépense directe) : l'étape stockée", () => {
    expect(etapeDepuisArticles("DECISION_FINALE", "OPTIONNELLE", [])).toBe("DECISION_FINALE");
  });
  it("anciennes étapes stockées (rejet DG, décision finale) : déduites des articles", () => {
    expect(etapeDepuisArticles("REJET_DG", "OPTIONNELLE", [l({ soumiseAuDG: true, decisionDG: "REFUSEE" })])).toBe("FINANCE");
    expect(etapeDepuisArticles("DECISION_FINALE", "OPTIONNELLE", [l({ soumiseAuDG: true, decisionDG: "VALIDEE" })])).toBe("FINANCE");
  });
  it("cas b (DG obligatoire) : étape DG tant qu'un article attend, puis Terminée", () => {
    expect(etapeDepuisArticles("DG", "OBLIGATOIRE", [l(), l({ statut: "VALIDEE" })])).toBe("DG");
    expect(etapeDepuisArticles("DG", "OBLIGATOIRE", [l({ statut: "VALIDEE" }), l({ statut: "REJETEE" })])).toBe("TERMINEE");
  });
});

describe("compteur d'articles traités et libellé « En cours »", () => {
  it("compte les articles validés ou rejetés", () => {
    expect(compteurArticlesTraites([l(), l({ statut: "VALIDEE" }), l({ statut: "REJETEE" })])).toEqual({ traites: 2, total: 3 });
  });
  it("« En cours (1/3 traité) » puis pluriel", () => {
    expect(libelleEnCours([l(), l(), l({ statut: "VALIDEE" })])).toBe("En cours (1/3 traité)");
    expect(libelleEnCours([l(), l({ statut: "VALIDEE" }), l({ statut: "REJETEE" })])).toBe("En cours (2/3 traités)");
  });
  it("pas « En cours » quand tous les articles sont traités ou sans article", () => {
    expect(libelleEnCours([l({ statut: "VALIDEE" }), l({ statut: "REJETEE" })])).toBeNull();
    expect(libelleEnCours([])).toBeNull();
  });
});

describe("montant validé = somme des articles validés", () => {
  it("ne compte que les articles validés, au centime", () => {
    expect(montantValideDepuisLignes([m("VALIDEE", 2, 1500.5), m("REJETEE", 1, 9999), m("EN_ATTENTE", 1, 5000), m("VALIDEE", 1, 0.1)])).toBe(3001.1);
  });
  it("aucun article validé : 0 ; arrondi d'un article", () => {
    expect(montantValideDepuisLignes([m("REJETEE"), m("EN_ATTENTE")])).toBe(0);
    expect(totalArticle({ quantite: 3, prixUnitaire: "0.1" })).toBe(0.3);
  });
});

describe("statutDepuisLignes", () => {
  const base = { statutActuel: "EN_ATTENTE_VALIDATION" as const, montant: 3000, montantValide: 0, totalRegle: 0 };
  it("aucun article traité : en attente de validation", () => {
    expect(statutDepuisLignes({ ...base, lignes: [m("EN_ATTENTE"), m("EN_ATTENTE"), m("EN_ATTENTE")] })).toBe("EN_ATTENTE_VALIDATION");
  });
  it("un article validé, d'autres en attente : partiellement validée (affichée « En cours »)", () => {
    expect(statutDepuisLignes({ ...base, lignes: [m("VALIDEE"), m("EN_ATTENTE"), m("EN_ATTENTE")] })).toBe("PARTIELLEMENT_VALIDEE");
  });
  it("articles rejetés + un en attente, aucun validé : toujours en attente de validation", () => {
    expect(statutDepuisLignes({ ...base, lignes: [m("REJETEE"), m("EN_ATTENTE")] })).toBe("EN_ATTENTE_VALIDATION");
  });
  it("tous traités, validé non réglé : validée non réglée (le statut suit alors le règlement)", () => {
    expect(statutDepuisLignes({ ...base, lignes: [m("VALIDEE"), m("VALIDEE"), m("REJETEE")] })).toBe("VALIDEE_NON_REGLEE");
  });
  it("règlement partiel puis complet du SEUL montant validé", () => {
    const lignes = [m("VALIDEE"), m("VALIDEE"), m("REJETEE")];
    expect(statutDepuisLignes({ ...base, totalRegle: 1000, lignes })).toBe("PARTIELLEMENT_REGLEE");
    expect(statutDepuisLignes({ ...base, totalRegle: 2000, lignes })).toBe("REGLEE");
  });
  it("« Réglée » est atteignable avec un article rejeté (montant demandé 3000, réglé 2000 = validé)", () => {
    expect(statutDepuisLignes({ ...base, statutActuel: "PARTIELLEMENT_VALIDEE", totalRegle: 2000, lignes: [m("VALIDEE"), m("VALIDEE"), m("REJETEE")] })).toBe("REGLEE");
  });
  it("tous les articles rejetés : en attente de validation (la demande repart en correction)", () => {
    expect(statutDepuisLignes({ ...base, lignes: [m("REJETEE"), m("REJETEE")] })).toBe("EN_ATTENTE_VALIDATION");
  });
  it("états terminaux inchangés", () => {
    for (const s of ["REJETEE", "CLOTUREE", "ABANDONNEE"] as const) {
      expect(statutDepuisLignes({ ...base, statutActuel: s, lignes: [m("VALIDEE")] })).toBe(s);
    }
  });
  it("sans article : règle d'origine (montant validé comparé au montant demandé)", () => {
    expect(statutDepuisLignes({ ...base, lignes: [] })).toBe("EN_ATTENTE_VALIDATION");
    expect(statutDepuisLignes({ ...base, montantValide: 1000, lignes: [] })).toBe("PARTIELLEMENT_VALIDEE");
    expect(statutDepuisLignes({ ...base, montantValide: 3000, lignes: [] })).toBe("VALIDEE_NON_REGLEE");
    expect(statutDepuisLignes({ ...base, montantValide: 3000, totalRegle: 3000, lignes: [] })).toBe("REGLEE");
  });
});

describe("appliquerDecisionsSimulees", () => {
  it("applique des décisions hypothétiques sans toucher les autres articles", () => {
    const lignes = [
      { id: "a", statut: "EN_ATTENTE" as const },
      { id: "b", statut: "EN_ATTENTE" as const },
    ];
    expect(appliquerDecisionsSimulees(lignes, [{ ligneId: "a", statut: "VALIDEE" }])).toEqual([
      { id: "a", statut: "VALIDEE" },
      { id: "b", statut: "EN_ATTENTE" },
    ]);
    expect(lignes[0].statut).toBe("EN_ATTENTE");
  });
});

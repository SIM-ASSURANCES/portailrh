import { describe, expect, it } from "vitest";

import {
  articleEstTermine,
  detailClotureForcee,
  evaluerCloture,
  instantaneClotureForcee,
  libelleArticleClotureForcee,
  lireInstantaneClotureForcee,
  manqueArticle,
  messageBlocageCloture,
  MOTIF_CLOTURE_FORCEE_MIN,
  refusClotureForcee,
  type ArticleCloture,
} from "./clotureDemande";
import { AGREGATS_VIDES, type AgregatsRegularisation } from "./regularisationArticle";

const agregats = (a: Partial<AgregatsRegularisation>): AgregatsRegularisation => ({ ...AGREGATS_VIDES, ...a });

function article(id: string, statut: ArticleCloture["statut"], montantValide: number, a: Partial<AgregatsRegularisation> = {}, retoursEnAttente = 0): ArticleCloture {
  return { ligneId: id, libelle: `Article ${id}`, beneficiaire: `Bénéf ${id}`, statut, montantValide, agregats: agregats(a), retoursEnAttente };
}

// A : 100 000 validé, réglé en entier, dépensé 60 000 et retourné 40 000 → solde 0 (régularisé).
const A = article("A", "VALIDEE", 100000, { fondsRemis: 100000, depensesJustifiees: 60000, retoursRecus: 40000 });
// B : 50 000 validé, réglé, dépenses 20 000, rien d'autre → solde 30 000, reste non détaillé 30 000.
const B = article("B", "VALIDEE", 50000, { fondsRemis: 50000, depensesJustifiees: 20000 });
// C : rejeté.
const C = article("C", "REJETEE", 0);

describe("article terminé", () => {
  it("rejeté : terminé ; encore à décider : jamais", () => {
    expect(articleEstTermine(C)).toBe(true);
    expect(articleEstTermine(article("X", "EN_ATTENTE", 0))).toBe(false);
  });

  it("validé, réglé en entier et à solde nul : terminé", () => {
    expect(articleEstTermine(A)).toBe(true);
  });

  it("validé mais non réglé : jamais terminé (même à solde nul)", () => {
    expect(articleEstTermine(article("N", "VALIDEE", 100000))).toBe(false);
  });

  it("réglé en partie, solde nul (fonds 60 000 = dépenses 60 000) : PAS terminé, il reste 40 000 à régler", () => {
    const partiel = article("P", "VALIDEE", 100000, { fondsRemis: 60000, depensesJustifiees: 60000 });
    expect(articleEstTermine(partiel)).toBe(false);
    expect(manqueArticle(partiel)?.resteARegler).toBe(40000);
  });

  it("réglé en entier mais solde non nul : pas terminé, avec ce qui manque", () => {
    expect(articleEstTermine(B)).toBe(false);
    const m = manqueArticle(B)!;
    expect(m.resteARegler).toBe(0);
    expect(m.solde).toBe(30000);
    expect(m.resteNonDetaille).toBe(30000);
  });

  it("solde négatif (anomalie) : pas terminé", () => {
    const anomalie = article("Z", "VALIDEE", 10000, { fondsRemis: 10000, depensesJustifiees: 12000 });
    expect(articleEstTermine(anomalie)).toBe(false);
    expect(manqueArticle(anomalie)?.solde).toBe(-2000);
  });
});

describe("évaluation de la clôture d'une demande à articles", () => {
  it("cas du lot : A régularisé, B non régularisé, C rejeté → clôture bloquée, B listé avec ce qui manque", () => {
    const e = evaluerCloture([A, B, C]);
    expect(e.decidee).toBe(true);
    expect(e.cloturable).toBe(false);
    expect(e.forcable).toBe(true);
    expect(e.bloquants.map((b) => b.ligneId)).toEqual(["B"]);
    expect(e.bloquants[0].manques).toContain("dépenses à détailler 30 000 FCFA");
    expect(e.bloquants[0].manques).toContain("solde à régulariser 30 000 FCFA");
    const msg = messageBlocageCloture(e.bloquants);
    expect(msg).toContain("« Article B » (bénéficiaire Bénéf B)");
    expect(msg).toContain("forcez la clôture avec un motif");
  });

  it("tout régularisé (ou rejeté) → clôturable, rien à forcer", () => {
    const e = evaluerCloture([A, C]);
    expect(e.cloturable).toBe(true);
    expect(e.forcable).toBe(false);
    expect(e.bloquants).toEqual([]);
  });

  it("un article non réglé est nommé avec son reste à régler et un retour en attente est compté", () => {
    const e = evaluerCloture([article("R", "VALIDEE", 80000, { fondsRemis: 30000, depensesJustifiees: 10000, retoursEnAttente: 20000 }, 1)]);
    expect(e.bloquants[0].manques[0]).toBe("reste à régler 50 000 FCFA");
    expect(e.bloquants[0].manques).toContain("1 retour de caisse à réceptionner");
  });

  it("un article encore à décider : demande non décidée, ni clôturable ni forçable", () => {
    const e = evaluerCloture([A, article("D", "EN_ATTENTE", 0)]);
    expect(e.decidee).toBe(false);
    expect(e.cloturable).toBe(false);
    expect(e.forcable).toBe(false);
  });

  it("tous rejetés : pas de clôture (la demande repart en correction)", () => {
    expect(evaluerCloture([C, article("C2", "REJETEE", 0)]).decidee).toBe(false);
  });

  it("la part non rattachée à un article, si son solde n'est pas nul, bloque aussi (jamais attribuée au hasard)", () => {
    const e = evaluerCloture([A], agregats({ fondsRemis: 5000 }));
    expect(e.cloturable).toBe(false);
    expect(e.bloquants[0].ligneId).toBeNull();
    expect(evaluerCloture([A], agregats({}))).toMatchObject({ cloturable: true });
  });
});

describe("clôture forcée : motif et garde 8", () => {
  const demande = {
    createurId: "demandeur",
    beneficiaireType: "COLLABORATEUR" as const,
    beneficiaireUserId: "benef-demande",
    beneficiaireNom: null,
    lignes: [
      { beneficiaireType: null, beneficiaireUserId: null, beneficiaireNom: null },
      { beneficiaireType: "COLLABORATEUR" as const, beneficiaireUserId: "benef-article", beneficiaireNom: null },
    ],
  };
  const evaluation = evaluerCloture([A, B, C]);
  const base = { demande, evaluation, motif: "Le fournisseur a disparu, solde irrécupérable." };

  it("un compte étranger à la demande, motif suffisant : permis", () => {
    expect(refusClotureForcee(base, "finance")).toBeNull();
  });

  it(`motif de ${MOTIF_CLOTURE_FORCEE_MIN} caractères minimum (9 refusé, 10 accepté, espaces ignorés)`, () => {
    expect(refusClotureForcee({ ...base, motif: "123456789" }, "finance")).toContain("10 caractères");
    expect(refusClotureForcee({ ...base, motif: "   123456789   " }, "finance")).toContain("10 caractères");
    expect(refusClotureForcee({ ...base, motif: "1234567890" }, "finance")).toBeNull();
    expect(refusClotureForcee({ ...base, motif: undefined }, "finance")).toContain("obligatoire");
  });

  it("garde 8 : ni le demandeur, ni le bénéficiaire de la demande, ni celui d'un article ne force la clôture", () => {
    for (const id of ["demandeur", "benef-demande", "benef-article"]) {
      expect(refusClotureForcee(base, id)).toContain("demandeur ou le bénéficiaire");
    }
  });

  it("rien à forcer quand tout est terminé ; demande non décidée : refus", () => {
    expect(refusClotureForcee({ ...base, evaluation: evaluerCloture([A, C]) }, "finance")).toContain("rien à forcer");
    expect(refusClotureForcee({ ...base, evaluation: evaluerCloture([A, article("D", "EN_ATTENTE", 0)]) }, "finance")).toContain("encore à décider");
  });
});

describe("instantané d'une clôture forcée et libellé « Clôturé sans régularisation »", () => {
  const e = evaluerCloture([A, B, C]);
  const inst = instantaneClotureForcee(e.bloquants);

  it("l'instantané garde le libellé, le bénéficiaire, le solde restant, et se relit depuis le JSON", () => {
    const relu = lireInstantaneClotureForcee(JSON.parse(JSON.stringify(inst)));
    expect(relu).toEqual(inst);
    expect(relu[0]).toMatchObject({ ligneId: "B", libelle: "Article B", solde: 30000 });
    expect(detailClotureForcee(relu)).toContain("« Article B » (solde restant 30 000 FCFA");
    expect(lireInstantaneClotureForcee("pas un tableau")).toEqual([]);
    expect(lireInstantaneClotureForcee([{ libelle: 3 }, null])).toEqual([]);
  });

  it("l'article non régularisé est « Clôturé sans régularisation » avec son solde ; terminé depuis (retour post-clôture) : plus rien", () => {
    expect(libelleArticleClotureForcee({ clotureForcee: true }, inst, "B", false, 30000)).toBe(
      "Clôturé sans régularisation — solde restant 30 000 FCFA"
    );
    expect(libelleArticleClotureForcee({ clotureForcee: true }, inst, "B", true, 0)).toBeNull();
    expect(libelleArticleClotureForcee({ clotureForcee: true }, inst, "A", false, 0)).toBeNull();
    expect(libelleArticleClotureForcee({ clotureForcee: false }, inst, "B", false, 30000)).toBeNull();
  });
});

describe("article jamais réglé (lot F : « reste à régler », jamais « solde restant 0 »)", () => {
  const N = article("N", "VALIDEE", 20000);
  const inst = instantaneClotureForcee(evaluerCloture([A, N]).bloquants);

  it("le détail d'une clôture forcée dit « reste à régler 20 000 FCFA » sans « solde restant 0 »", () => {
    const detail = detailClotureForcee(inst);
    expect(detail).toBe("« Article N » (reste à régler 20 000 FCFA)");
    expect(detail).not.toContain("solde restant");
  });

  it("le badge de l'article jamais réglé dit « reste à régler », celui d'un article réglé garde « solde restant »", () => {
    expect(libelleArticleClotureForcee({ clotureForcee: true }, inst, "N", false, 0)).toBe(
      "Clôturé sans régularisation — reste à régler 20 000 FCFA"
    );
    const instB = instantaneClotureForcee(evaluerCloture([A, B]).bloquants);
    expect(libelleArticleClotureForcee({ clotureForcee: true }, instB, "B", false, 30000)).toContain("solde restant 30 000 FCFA");
  });
});

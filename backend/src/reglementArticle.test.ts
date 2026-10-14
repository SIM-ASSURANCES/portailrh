import { describe, expect, it } from "vitest";

import {
  allocationsReglementArticle,
  beneficiairesBloquesReglement,
  MESSAGE_ARTICLE_A_CHOISIR,
  MESSAGE_ARTICLE_DEJA_REGLE,
  MESSAGE_ARTICLE_INTROUVABLE,
  MESSAGE_ARTICLE_NON_VALIDE,
  MESSAGE_REGLEMENTS_NON_RATTACHES,
  montantValideArticle,
  resteAReglerArticle,
  reglementsNonRattaches,
  totalRegleArticle,
  verdictConfirmationReglementArticle,
  verdictReglementArticle,
  type ArticleReglable,
  type ReglementArticle,
} from "./reglementArticle";

const art = (id: string, prix: number, statut: ArticleReglable["statutValidation"] = "VALIDEE", categorieId: string | null = "cat-" + id): ArticleReglable => ({
  id,
  libelle: `Article ${id}`,
  quantite: 1,
  prixUnitaire: prix,
  statutValidation: statut,
  categorieId,
});
const reg = (ligneDemandeId: string | null, montant: number, o: Partial<ReglementArticle> = {}): ReglementArticle => ({
  ligneDemandeId,
  montant,
  estConfirme: true,
  estAnnule: false,
  ...o,
});

describe("montants par article", () => {
  it("seul un article validé a un montant à régler", () => {
    expect(montantValideArticle(art("a", 1000))).toBe(1000);
    expect(montantValideArticle(art("a", 1000, "EN_ATTENTE"))).toBe(0);
    expect(montantValideArticle(art("a", 1000, "REJETEE"))).toBe(0);
  });

  it("le réglé ne compte que les règlements confirmés, non annulés, de CET article", () => {
    const rs = [reg("a", 300), reg("a", 100, { estConfirme: false }), reg("a", 50, { estAnnule: true }), reg("b", 999)];
    expect(totalRegleArticle(rs, "a")).toBe(300);
    expect(resteAReglerArticle(art("a", 1000), rs)).toBe(700);
  });

  it("le reste n'est jamais négatif et s'additionne au centime", () => {
    expect(resteAReglerArticle(art("a", 100), [reg("a", 100.1)])).toBe(0);
    expect(totalRegleArticle([reg("a", 0.1), reg("a", 0.2)], "a")).toBe(0.3);
  });
});

describe("verdict d'un règlement par article", () => {
  const articles = [art("a", 1000), art("b", 500), art("c", 800, "EN_ATTENTE")];

  it("régler un article validé ne touche pas les autres : le plafond est celui de l'article", () => {
    expect(verdictReglementArticle({ articles, reglements: [], ligneDemandeId: "a", montant: 1000 })).toMatchObject({ ok: true, reste: 1000 });
    const v = verdictReglementArticle({ articles, reglements: [], ligneDemandeId: "b", montant: 600 });
    expect(v).toMatchObject({ ok: false, champ: "montant" });
  });

  it("plusieurs règlements partiels d'un même article, dans la limite de son montant validé", () => {
    const rs = [reg("a", 400)];
    expect(verdictReglementArticle({ articles, reglements: rs, ligneDemandeId: "a", montant: 600 })).toMatchObject({ ok: true, reste: 600 });
    expect(verdictReglementArticle({ articles, reglements: rs, ligneDemandeId: "a", montant: 601 })).toMatchObject({ ok: false, champ: "montant" });
  });

  it("l'article doit être choisi, de la demande, et validé", () => {
    expect(verdictReglementArticle({ articles, reglements: [], ligneDemandeId: null })).toMatchObject({ ok: false, message: MESSAGE_ARTICLE_A_CHOISIR });
    expect(verdictReglementArticle({ articles, reglements: [], ligneDemandeId: "zzz" })).toMatchObject({ ok: false, message: MESSAGE_ARTICLE_INTROUVABLE });
    expect(verdictReglementArticle({ articles, reglements: [], ligneDemandeId: "c", montant: 10 })).toMatchObject({ ok: false, message: MESSAGE_ARTICLE_NON_VALIDE });
  });

  it("un article entièrement réglé n'accepte plus de règlement", () => {
    expect(verdictReglementArticle({ articles, reglements: [reg("b", 500)], ligneDemandeId: "b", montant: 1 })).toMatchObject({
      ok: false,
      message: MESSAGE_ARTICLE_DEJA_REGLE,
    });
  });

  it("une demande sans article (dépense directe) reste réglée au niveau de la demande", () => {
    expect(verdictReglementArticle({ articles: [], reglements: [], ligneDemandeId: undefined, montant: 10 })).toMatchObject({ ok: true, ligne: null });
  });

  it("des règlements non rattachés bloquent tout nouveau règlement, annulés exceptés", () => {
    const rs = [reg(null, 200)];
    expect(reglementsNonRattaches(rs)).toHaveLength(1);
    expect(verdictReglementArticle({ articles, reglements: rs, ligneDemandeId: "a", montant: 10 })).toMatchObject({
      ok: false,
      message: MESSAGE_REGLEMENTS_NON_RATTACHES,
    });
    expect(reglementsNonRattaches([reg(null, 200, { estAnnule: true })])).toHaveLength(0);
    expect(verdictReglementArticle({ articles, reglements: [reg(null, 200, { estAnnule: true })], ligneDemandeId: "a", montant: 10 }).ok).toBe(true);
  });

  it("la confirmation revérifie l'article, les non rattachés et le plafond", () => {
    const rs = [reg("a", 900), reg("a", 200, { estConfirme: false })];
    expect(verdictConfirmationReglementArticle({ articles, reglements: rs, reglement: { ligneDemandeId: "a", montant: 200 } })).toMatchObject({
      ok: false,
      champ: "montant",
    });
    expect(verdictConfirmationReglementArticle({ articles, reglements: rs, reglement: { ligneDemandeId: "a", montant: 100 } }).ok).toBe(true);
    expect(verdictConfirmationReglementArticle({ articles, reglements: rs, reglement: { ligneDemandeId: null, montant: 100 } }).ok).toBe(false);
  });
});

describe("budget : l'allocation suit la catégorie de l'article", () => {
  it("100 % vers la catégorie de l'article, aucune s'il n'est pas catégorisé", () => {
    expect(allocationsReglementArticle(art("a", 1), null, 50)).toEqual([{ categorieId: "cat-a", montant: 50 }]);
    expect(allocationsReglementArticle(art("a", 1, "VALIDEE", null), "cat-demande", 50)).toEqual([]);
  });
  it("sans article (dépense directe) : la catégorie de la demande", () => {
    expect(allocationsReglementArticle(null, "cat-demande", 50)).toEqual([{ categorieId: "cat-demande", montant: 50 }]);
    expect(allocationsReglementArticle(null, null, 50)).toEqual([]);
  });
});

describe("notification « Demande à régler » : qui est écarté", () => {
  const demande = { beneficiaireUserId: "u-demande" };
  const l = (statutValidation: "VALIDEE" | "REJETEE" | "EN_ATTENTE", beneficiaireType: unknown, beneficiaireUserId: string | null) => ({ statutValidation, beneficiaireType, beneficiaireUserId });

  it("un bénéficiaire d'un seul article validé peut régler les autres : il n'est pas écarté", () => {
    expect(beneficiairesBloquesReglement(demande, [l("VALIDEE", "COLLABORATEUR", "u-bob"), l("VALIDEE", null, null)])).toEqual([]);
  });
  it("bénéficiaire de TOUS les articles validés : écarté ; les articles non validés ne comptent pas", () => {
    expect(beneficiairesBloquesReglement(demande, [l("VALIDEE", "COLLABORATEUR", "u-bob"), l("VALIDEE", "COLLABORATEUR", "u-bob"), l("REJETEE", null, null)])).toEqual(["u-bob"]);
    expect(beneficiairesBloquesReglement(demande, [l("VALIDEE", null, null), l("VALIDEE", null, null)])).toEqual(["u-demande"]);
  });
  it("sans article validé : le bénéficiaire de la demande", () => {
    expect(beneficiairesBloquesReglement(demande, [l("EN_ATTENTE", null, null)])).toEqual(["u-demande"]);
  });
});

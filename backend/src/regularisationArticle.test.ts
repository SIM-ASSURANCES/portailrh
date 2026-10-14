import { describe, expect, it } from "vitest";

import { parcoursArticle } from "./parcoursArticle";
import {
  additionnerAgregats,
  agregerRegularisation,
  articleTermine,
  categorieDepense,
  dateRegularisation,
  depensesDeclareesLigne,
  etatRegularisationArticle,
  getEcartLigne,
  resteNonDetailleTotal,
  totauxBandeArticle,
  resumeArticlesTermines,
  type AgregatsRegularisation,
} from "./regularisationArticle";

const ag = (p: Partial<AgregatsRegularisation> = {}): AgregatsRegularisation => ({
  fondsRemis: 0,
  depensesJustifiees: 0,
  depensesSansPieceFormelle: 0,
  resteNonDetaille: 0,
  retoursRecus: 0,
  retoursEnAttente: 0,
  ...p,
});

describe("getEcartLigne", () => {
  it("fonds remis − dépenses (3 catégories) − retours reçus", () => {
    expect(getEcartLigne(ag({ fondsRemis: 100000, depensesJustifiees: 30000, depensesSansPieceFormelle: 20000, retoursRecus: 50000 }))).toBe(0);
    expect(getEcartLigne(ag({ fondsRemis: 100000, depensesJustifiees: 30000, resteNonDetaille: 10000 }))).toBe(60000);
  });
  it("jamais plafonné à 0 : un négatif signale une anomalie", () => {
    expect(getEcartLigne(ag({ fondsRemis: 10000, depensesJustifiees: 12000 }))).toBe(-2000);
  });
  it("centimes exacts, sans résidu flottant", () => {
    expect(getEcartLigne(ag({ fondsRemis: 0.3, depensesJustifiees: 0.1, retoursRecus: 0.2 }))).toBe(0);
    expect(depensesDeclareesLigne(ag({ depensesJustifiees: 0.1, depensesSansPieceFormelle: 0.2 }))).toBe(0.3);
  });
});

describe("categorieDepense", () => {
  it("classe justifiée, sans pièce formelle (motif) et reste non détaillé", () => {
    expect(categorieDepense({ justification: "FACTURE", objet: "Taxi", motifNonJustifie: null })).toBe("JUSTIFIEE");
    expect(categorieDepense({ justification: "SANS_PIECE", objet: "Taxi", motifNonJustifie: "Pas de reçu" })).toBe("SANS_PIECE_FORMELLE");
    expect(categorieDepense({ justification: "SANS_PIECE", objet: "Dépenses non détaillées", motifNonJustifie: null })).toBe("RESTE_NON_DETAILLE");
    expect(categorieDepense({ justification: "SANS_PIECE", objet: "Dépenses non détaillées", motifNonJustifie: "Motif" })).toBe("SANS_PIECE_FORMELLE");
  });
});

describe("agregerRegularisation : une demande à 3 articles", () => {
  // A réglé 100 000 (retour 40 000 reçu, dépenses 60 000), B réglé 50 000 (dépenses 30 000 sans retour), C non réglé.
  const reglements = [
    { id: "rA", ligneDemandeId: "A", montant: 100000, estConfirme: true, estAnnule: false },
    { id: "rB", ligneDemandeId: "B", montant: 50000, estConfirme: true, estAnnule: false },
    { id: "rBann", ligneDemandeId: "B", montant: 99999, estConfirme: true, estAnnule: true },
  ];
  const retours = [
    {
      reglementId: "rA",
      estReceptionne: true,
      montantARetourner: 40000,
      depenses: [
        { montant: 45000, justification: "FACTURE", objet: "Achat", motifNonJustifie: null },
        { montant: 15000, justification: "SANS_PIECE", objet: "Taxi", motifNonJustifie: "Perdu" },
      ],
    },
    {
      reglementId: "rB",
      estReceptionne: false,
      montantARetourner: 20000,
      depenses: [{ montant: 30000, justification: "SANS_PIECE", objet: "Dépenses non détaillées", motifNonJustifie: null }],
    },
  ];
  const r = agregerRegularisation({ reglements, retours, remboursements: [], exceptionnels: [] });

  it("soldes indépendants par article", () => {
    expect(getEcartLigne(r.parArticle.get("A")!)).toBe(0);
    expect(getEcartLigne(r.parArticle.get("B")!)).toBe(20000);
    expect(r.parArticle.has("C")).toBe(false);
  });
  it("les trois catégories de dépenses sont séparées", () => {
    expect(r.parArticle.get("A")).toMatchObject({ depensesJustifiees: 45000, depensesSansPieceFormelle: 15000, resteNonDetaille: 0 });
    expect(r.parArticle.get("B")).toMatchObject({ depensesJustifiees: 0, resteNonDetaille: 30000 });
  });
  it("un règlement annulé ne compte pas dans les fonds remis", () => {
    expect(r.parArticle.get("B")!.fondsRemis).toBe(50000);
  });
  it("total = somme des articles + non rattaché (invariant avec getEcart)", () => {
    expect(getEcartLigne(r.total)).toBe(0 + 20000 + getEcartLigne(r.nonRattache));
    expect(r.total.fondsRemis).toBe(150000);
  });
  it("les remboursements validés viennent en déduction des retours de CET article", () => {
    const x = agregerRegularisation({ reglements, retours, remboursements: [{ reglementId: "rA", montant: 5000 }], exceptionnels: [] });
    expect(x.parArticle.get("A")!.retoursRecus).toBe(35000);
    expect(getEcartLigne(x.parArticle.get("B")!)).toBe(20000);
  });
  it("un retour exceptionnel rattaché ne touche que son article ; sans article il reste non rattaché", () => {
    const x = agregerRegularisation({
      reglements,
      retours,
      remboursements: [],
      exceptionnels: [
        { ligneDemandeId: "B", montant: 20000 },
        { ligneDemandeId: null, montant: 3000 },
      ],
    });
    expect(getEcartLigne(x.parArticle.get("B")!)).toBe(0);
    expect(getEcartLigne(x.parArticle.get("A")!)).toBe(0);
    expect(x.nonRattache.retoursRecus).toBe(3000);
    expect(getEcartLigne(x.total)).toBe(-3000);
  });
  it("demande sans article : tout est non rattaché, le total est inchangé", () => {
    const x = agregerRegularisation({
      reglements: [{ id: "r1", ligneDemandeId: null, montant: 10000, estConfirme: true, estAnnule: false }],
      retours: [{ reglementId: "r1", estReceptionne: true, montantARetourner: 4000, depenses: [{ montant: 6000, justification: "FACTURE", objet: "x", motifNonJustifie: null }] }],
      remboursements: [],
      exceptionnels: [],
    });
    expect(x.parArticle.size).toBe(0);
    expect(getEcartLigne(x.total)).toBe(0);
    expect(additionnerAgregats([x.nonRattache])).toEqual(x.total);
  });
});

describe("lot G — un article réglé par caisse ET par banque", () => {
  // Article A de 100 000 : règlement 1 de 60 000 (caisse), règlement 2 de 40 000 (banque). Le mode ne figure pas dans l'entrée :
  // la régularisation ne lit jamais le mode, tous les règlements confirmés comptent.
  const reglements = [
    { id: "caisse", ligneDemandeId: "A", montant: 60000, estConfirme: true, estAnnule: false },
    { id: "banque", ligneDemandeId: "A", montant: 40000, estConfirme: true, estAnnule: false },
  ];
  it("fonds remis = somme des deux, solde à régulariser = 100 000 tant que rien n'est justifié", () => {
    const r = agregerRegularisation({ reglements, retours: [], remboursements: [], exceptionnels: [] });
    expect(r.parArticle.get("A")!.fondsRemis).toBe(100000);
    expect(getEcartLigne(r.parArticle.get("A")!)).toBe(100000);
    expect(etatRegularisationArticle({ valide: true, agregats: r.parArticle.get("A")! })).toBe("A_REGULARISER");
  });
  it("dépenses sur le règlement banque + retour reçu sur le règlement caisse : régularisé à 0", () => {
    const r = agregerRegularisation({
      reglements,
      retours: [
        { reglementId: "banque", estReceptionne: false, montantARetourner: 0, depenses: [{ montant: 40000, justification: "FACTURE", objet: "Achat", motifNonJustifie: null }] },
        { reglementId: "caisse", estReceptionne: true, montantARetourner: 20000, depenses: [{ montant: 40000, justification: "FACTURE", objet: "Achat", motifNonJustifie: null }] },
      ],
      remboursements: [],
      exceptionnels: [],
    });
    expect(getEcartLigne(r.parArticle.get("A")!)).toBe(0);
    expect(etatRegularisationArticle({ valide: true, agregats: r.parArticle.get("A")! })).toBe("REGULARISE");
  });
});

describe("état de régularisation et article terminé", () => {
  it("non validé, en attente de règlement, à régulariser, régularisé, anomalie", () => {
    expect(etatRegularisationArticle({ valide: false, agregats: ag() })).toBe("REJETE_OU_EN_ATTENTE");
    expect(etatRegularisationArticle({ valide: true, agregats: ag() })).toBe("ATTENTE_REGLEMENT");
    expect(etatRegularisationArticle({ valide: true, agregats: ag({ fondsRemis: 100, depensesJustifiees: 40 }) })).toBe("A_REGULARISER");
    expect(etatRegularisationArticle({ valide: true, agregats: ag({ fondsRemis: 100, depensesJustifiees: 100 }) })).toBe("REGULARISE");
    expect(etatRegularisationArticle({ valide: true, agregats: ag({ fondsRemis: 100, depensesJustifiees: 120 }) })).toBe("ANOMALIE");
  });
  it("article terminé : rejeté, ou validé réglé à solde nul", () => {
    expect(articleTermine({ statut: "REJETEE", agregats: ag() })).toBe(true);
    expect(articleTermine({ statut: "EN_ATTENTE", agregats: ag() })).toBe(false);
    expect(articleTermine({ statut: "VALIDEE", agregats: ag({ fondsRemis: 100, depensesJustifiees: 100 }) })).toBe(true);
    expect(articleTermine({ statut: "VALIDEE", agregats: ag({ fondsRemis: 100 }) })).toBe(false);
    expect(resumeArticlesTermines([{ termine: true, rejete: false }, { termine: false, rejete: false }, { termine: true, rejete: true }])).toBe("1 article régularisé sur 2");
  });
  it("date de régularisation : la plus récente, seulement à solde nul", () => {
    const d1 = new Date("2026-10-01");
    const d2 = new Date("2026-10-05");
    expect(dateRegularisation({ agregats: ag({ fondsRemis: 100, depensesJustifiees: 100 }), dates: [d1, null, d2] })).toEqual(d2);
    expect(dateRegularisation({ agregats: ag({ fondsRemis: 100, depensesJustifiees: 50 }), dates: [d1] })).toBeNull();
    expect(dateRegularisation({ agregats: ag({ fondsRemis: 100, depensesJustifiees: 100 }), dates: [] })).toBeNull();
  });
});

describe("parcours : Régularisé avec date et solde final", () => {
  const reglement = { id: "r", montant: 100000, mode: "CAISSE" as const, estConfirme: true, estAnnule: false, confirmeAt: new Date("2026-10-01"), solde: 0, retours: [{ estReceptionne: true, montantARetourner: 40000 }] };
  const base = { statut: "VALIDEE" as const, etat: "VALIDEE" as const, montant: 100000, beneficiaire: "X", decidePar: "F", decideAt: new Date("2026-09-30"), confirmeParFinance: null, motifRejet: null, reglements: [reglement] };
  const agregats = ag({ fondsRemis: 100000, depensesJustifiees: 60000, retoursRecus: 40000 });
  it("affiche la date et le solde final", () => {
    const p = parcoursArticle({ ...base, regularisation: { agregats, regulariseAt: new Date("2026-10-07") } });
    expect(p.badge).toBe("REGULARISE");
    const etape = p.etapes.find((e) => e.cle === "REGULARISE")!;
    expect(etape.lignes[0]).toMatch(/^Régularisé le /);
    expect(etape.lignes.join("\n")).toContain("Solde final : 0 FCFA");
  });
  it("un retour exceptionnel rattaché ne rend plus rien indéterminé ; sans article il reste indéterminé", () => {
    expect(parcoursArticle({ ...base, regularisation: { agregats, regulariseAt: null } }).note).toBeNull();
    const p = parcoursArticle({ ...base, regularisationIndeterminee: true });
    expect(p.badge).not.toBe("REGULARISE");
    expect(p.note).toMatch(/aucun article/);
  });
});

describe("reste non détaillé d'un article avec fonds Caisse + Banque (lot G ter)", () => {
  // 471 000 Caisse + 100 000 Banque, 100 000 retournés, 300 000 justifiées + 71 000 sans pièce.
  const cas = { fondsRemis: 571000, retoursRecus: 100000, depensesJustifiees: 300000, depensesSansPieceFormelle: 71000 };
  it("les 100 000 du fonds banque ni retournés ni détaillés forment le reste non détaillé", () => {
    const a = ag(cas);
    expect(getEcartLigne(a)).toBe(100000);
    expect(resteNonDetailleTotal(a)).toBe(100000);
    expect(etatRegularisationArticle({ valide: true, agregats: a })).toBe("A_REGULARISER");
  });
  it("une fois détaillé (ligne de reste ou dépenses réelles), le solde et le reste tombent à 0", () => {
    const a = ag({ ...cas, depensesJustifiees: 400000 });
    expect(getEcartLigne(a)).toBe(0);
    expect(resteNonDetailleTotal(a)).toBe(0);
    expect(etatRegularisationArticle({ valide: true, agregats: a })).toBe("REGULARISE");
  });
  it("une ligne de reste stockée n'est pas comptée deux fois", () => {
    const a = ag({ ...cas, resteNonDetaille: 100000 });
    expect(getEcartLigne(a)).toBe(0);
    expect(resteNonDetailleTotal(a)).toBe(100000);
  });
  it("un retour déclaré en attente de réception n'est pas du « non détaillé »", () => {
    const a = ag({ ...cas, retoursEnAttente: 100000 });
    expect(resteNonDetailleTotal(a)).toBe(0);
  });
  it("jamais négatif en cas d'anomalie", () => {
    expect(resteNonDetailleTotal(ag({ fondsRemis: 1000, depensesJustifiees: 5000 }))).toBe(0);
  });
});

describe("bande « Total de l'article » (lot G quater)", () => {
  it("471 000 Caisse + 100 000 Banque, 100 000 retournés, 400 000 + 71 000 de dépenses", () => {
    const t = totauxBandeArticle(ag({ fondsRemis: 571000, retoursRecus: 100000, depensesJustifiees: 400000, depensesSansPieceFormelle: 71000 }));
    expect(t).toEqual({ remis: 571000, detaille: 471000, reste: 0, sansPiece: 71000, retourne: 100000 });
  });
  it("le fonds banque non détaillé apparaît dans le reste (même calcul que resteNonDetailleTotal)", () => {
    const a = ag({ fondsRemis: 571000, retoursRecus: 100000, depensesJustifiees: 300000, depensesSansPieceFormelle: 71000 });
    const t = totauxBandeArticle(a);
    expect(t.detaille).toBe(371000);
    expect(t.reste).toBe(resteNonDetailleTotal(a));
    expect(t.reste).toBe(100000);
  });
  it("une ligne de reste stockée n'est pas comptée dans « Détaillé »", () => {
    const t = totauxBandeArticle(ag({ fondsRemis: 100000, depensesJustifiees: 60000, resteNonDetaille: 40000 }));
    expect(t.detaille).toBe(60000);
    expect(t.reste).toBe(40000);
  });
});

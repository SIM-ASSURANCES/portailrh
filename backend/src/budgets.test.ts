import { describe, expect, it } from "vitest";

import {
  budgetEnVigueur,
  DATE_DEBUT_BUDGET_REPRIS,
  lireSnapshotBudget,
  phrasesSnapshotBudget,
  snapshotBudgetLigne,
  niveauAlerte,
  parametrageDepuisBudgetExistant,
  phrasePerimetre,
  phrasesAlertes,
  previsionBudget,
  SEUIL_BUDGET_PAR_DEFAUT,
  validerSaisieParametrage,
  verdictBudget,
  type ContexteBudget,
  type ParametrageBudget,
  type PerimetreBudget,
} from "./budgets";

const AUJOURDHUI = "2026-10-19";

const perimetre = (p: Partial<PerimetreBudget> & Pick<PerimetreBudget, "budget" | "reserve">): PerimetreBudget => ({
  parametrageId: "p1",
  portee: "CATEGORIE",
  categorieId: "cat1",
  libelle: "Informatique",
  seuil: { mode: "POURCENTAGE", orange: 20, rouge: 10 },
  ...p,
});

describe("niveauAlerte — mode pourcentage restant", () => {
  const seuil = { mode: "POURCENTAGE" as const, orange: 20, rouge: 10 };
  it("au-dessus de l'orange : aucune alerte", () => expect(niveauAlerte(250, 1000, seuil)).toBe("AUCUN"));
  it("orange inclus à 20 %", () => expect(niveauAlerte(200, 1000, seuil)).toBe("ORANGE"));
  it("entre orange et rouge : orange", () => expect(niveauAlerte(150, 1000, seuil)).toBe("ORANGE"));
  it("rouge inclus à 10 %", () => expect(niveauAlerte(100, 1000, seuil)).toBe("ROUGE"));
  it("dépassement : rouge", () => expect(niveauAlerte(-1, 1000, seuil)).toBe("ROUGE"));
  it("sans seuil : jamais d'alerte, même en dépassement", () => expect(niveauAlerte(-500, 1000, null)).toBe("AUCUN"));
  it("centimes exacts (pas de flottant)", () => {
    expect(niveauAlerte(0.3, 1.5, seuil)).toBe("ORANGE"); // 20 % pile
    expect(niveauAlerte(0.29, 1.5, seuil)).toBe("ORANGE");
    expect(niveauAlerte(0.31, 1.5, seuil)).toBe("AUCUN");
  });
});

describe("niveauAlerte — mode montant restant", () => {
  const seuil = { mode: "MONTANT" as const, orange: 500_000, rouge: 100_000 };
  it("au-dessus : aucune alerte", () => expect(niveauAlerte(600_000, 10_000_000, seuil)).toBe("AUCUN"));
  it("orange inclus", () => expect(niveauAlerte(500_000, 10_000_000, seuil)).toBe("ORANGE"));
  it("rouge inclus", () => expect(niveauAlerte(100_000, 10_000_000, seuil)).toBe("ROUGE"));
  it("négatif : rouge", () => expect(niveauAlerte(-1, 10_000_000, seuil)).toBe("ROUGE"));
});

describe("seuil par défaut (budgets repris)", () => {
  it("orange à 20 % restants, rouge à 0 %", () => expect(SEUIL_BUDGET_PAR_DEFAUT).toEqual({ mode: "POURCENTAGE", orange: 20, rouge: 0 }));
  it("ne bloque pas tant que le budget n'est pas épuisé", () => {
    expect(niveauAlerte(1, 1_000_000, SEUIL_BUDGET_PAR_DEFAUT)).toBe("ORANGE");
    expect(niveauAlerte(0, 1_000_000, SEUIL_BUDGET_PAR_DEFAUT)).toBe("ROUGE");
  });
});

describe("validerSaisieParametrage", () => {
  const base = { portee: "CATEGORIE" as const, categorieId: "cat1", montant: 1_000_000, dateDebut: AUJOURDHUI };
  it("accepte un paramétrage complet", () => {
    const r = validerSaisieParametrage({ ...base, dateFin: "2026-12-31", seuil: { mode: "POURCENTAGE", orange: 20, rouge: 10 } }, AUJOURDHUI);
    expect(r.ok).toBe(true);
  });
  it("accepte un paramétrage sans seuil ni fin", () => expect(validerSaisieParametrage(base, AUJOURDHUI).ok).toBe(true));
  it("le budget global ne prend pas de catégorie", () => {
    expect(validerSaisieParametrage({ ...base, portee: "GLOBAL", categorieId: null }, AUJOURDHUI).ok).toBe(true);
    const r = validerSaisieParametrage({ ...base, portee: "GLOBAL" }, AUJOURDHUI);
    expect(r.ok).toBe(false);
  });
  it("une catégorie est obligatoire pour un budget de catégorie", () => {
    const r = validerSaisieParametrage({ ...base, categorieId: null }, AUJOURDHUI);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs.categorieId).toBeDefined();
  });
  it("refuse montant nul, négatif ou à trois décimales", () => {
    for (const montant of [0, -5, 10.123]) expect(validerSaisieParametrage({ ...base, montant }, AUJOURDHUI).ok).toBe(false);
  });
  it("refuse un début dans le passé et accepte aujourd'hui", () => {
    expect(validerSaisieParametrage({ ...base, dateDebut: "2026-10-18" }, AUJOURDHUI).ok).toBe(false);
    expect(validerSaisieParametrage({ ...base, dateDebut: AUJOURDHUI }, AUJOURDHUI).ok).toBe(true);
  });
  it("refuse une fin avant le début et une date invalide", () => {
    expect(validerSaisieParametrage({ ...base, dateDebut: "2026-11-01", dateFin: "2026-10-31" }, AUJOURDHUI).ok).toBe(false);
    expect(validerSaisieParametrage({ ...base, dateDebut: "2026-02-30" }, AUJOURDHUI).ok).toBe(false);
    expect(validerSaisieParametrage({ ...base, dateFin: "demain" }, AUJOURDHUI).ok).toBe(false);
  });
  it("la fin le même jour que le début est acceptée", () => {
    expect(validerSaisieParametrage({ ...base, dateFin: AUJOURDHUI }, AUJOURDHUI).ok).toBe(true);
  });
  it("refuse un rouge égal ou supérieur à l'orange", () => {
    for (const [orange, rouge] of [[20, 20], [10, 20]]) {
      const r = validerSaisieParametrage({ ...base, seuil: { mode: "POURCENTAGE", orange, rouge } }, AUJOURDHUI);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.erreurs.seuilRouge).toMatch(/plus bas/);
    }
  });
  it("refuse un pourcentage hors 0–100 et des niveaux négatifs", () => {
    expect(validerSaisieParametrage({ ...base, seuil: { mode: "POURCENTAGE", orange: 120, rouge: 10 } }, AUJOURDHUI).ok).toBe(false);
    expect(validerSaisieParametrage({ ...base, seuil: { mode: "POURCENTAGE", orange: 20, rouge: -1 } }, AUJOURDHUI).ok).toBe(false);
  });
  it("mode montant : le niveau orange ne dépasse pas le budget", () => {
    expect(validerSaisieParametrage({ ...base, seuil: { mode: "MONTANT", orange: 2_000_000, rouge: 100 } }, AUJOURDHUI).ok).toBe(false);
    expect(validerSaisieParametrage({ ...base, seuil: { mode: "MONTANT", orange: 300_000, rouge: 100_000 } }, AUJOURDHUI).ok).toBe(true);
  });
  it("rouge à 0 est admis (alerte à l'épuisement)", () => {
    expect(validerSaisieParametrage({ ...base, seuil: { mode: "POURCENTAGE", orange: 20, rouge: 0 } }, AUJOURDHUI).ok).toBe(true);
  });
  it("mode inconnu refusé", () => {
    // @ts-expect-error mode volontairement invalide
    expect(validerSaisieParametrage({ ...base, seuil: { mode: "AUTRE", orange: 20, rouge: 10 } }, AUJOURDHUI).ok).toBe(false);
  });
});

describe("budgetEnVigueur — date d'effet et remplacement", () => {
  const p = (o: Partial<ParametrageBudget> & { id: string }): ParametrageBudget => ({
    portee: "CATEGORIE",
    categorieId: "cat1",
    montant: 1000,
    dateDebut: "2026-01-01",
    dateFin: null,
    seuil: null,
    statut: "VALIDE",
    ...o,
  });
  it("un paramétrage en attente ou refusé n'est jamais pris en compte", () => {
    const l = [p({ id: "a", statut: "EN_ATTENTE" }), p({ id: "b", statut: "REFUSE" })];
    expect(budgetEnVigueur(l, "CATEGORIE", "cat1", "2026-10-19")).toBeNull();
  });
  it("pas encore en vigueur avant sa date de début", () => {
    expect(budgetEnVigueur([p({ id: "a", dateDebut: "2026-11-01" })], "CATEGORIE", "cat1", "2026-10-19")).toBeNull();
  });
  it("plus en vigueur après sa date de fin (inclus le dernier jour)", () => {
    const l = [p({ id: "a", dateFin: "2026-10-19" })];
    expect(budgetEnVigueur(l, "CATEGORIE", "cat1", "2026-10-19")?.id).toBe("a");
    expect(budgetEnVigueur(l, "CATEGORIE", "cat1", "2026-10-20")).toBeNull();
  });
  it("le nouveau remplace l'ancien à sa date d'effet, l'ancien reste intact", () => {
    const ancien = p({ id: "ancien", montant: 1000 });
    const nouveau = p({ id: "nouveau", montant: 2000, dateDebut: "2026-11-01" });
    expect(budgetEnVigueur([ancien, nouveau], "CATEGORIE", "cat1", "2026-10-31")?.id).toBe("ancien");
    expect(budgetEnVigueur([ancien, nouveau], "CATEGORIE", "cat1", "2026-11-01")?.id).toBe("nouveau");
    expect(ancien.montant).toBe(1000);
  });
  it("même début : la décision la plus récente l'emporte", () => {
    const l = [p({ id: "a", decideAt: "2026-10-01T10:00:00Z" }), p({ id: "b", decideAt: "2026-10-02T10:00:00Z" })];
    expect(budgetEnVigueur(l, "CATEGORIE", "cat1", "2026-10-19")?.id).toBe("b");
  });
  it("séparation global / catégories", () => {
    const l = [p({ id: "g", portee: "GLOBAL", categorieId: null }), p({ id: "c1" }), p({ id: "c2", categorieId: "cat2" })];
    expect(budgetEnVigueur(l, "GLOBAL", null, "2026-10-19")?.id).toBe("g");
    expect(budgetEnVigueur(l, "CATEGORIE", "cat2", "2026-10-19")?.id).toBe("c2");
    expect(budgetEnVigueur(l, "CATEGORIE", "cat3", "2026-10-19")).toBeNull();
  });
});

describe("previsionBudget — restes après validation", () => {
  const contexte = (): ContexteBudget => ({
    global: perimetre({ parametrageId: "g", portee: "GLOBAL", categorieId: null, libelle: "Global", budget: 10_000_000, reserve: 4_000_000, seuil: { mode: "MONTANT", orange: 3_000_000, rouge: 1_000_000 } }),
    categories: { cat1: perimetre({ budget: 1_000_000, reserve: 600_000 }) },
  });
  it("calcule le reste global ET celui de la catégorie après la validation", () => {
    const p = previsionBudget(contexte(), [{ categorieId: "cat1", montant: 100_000 }]);
    expect(p.global?.resteAvant).toBe(6_000_000);
    expect(p.global?.resteApres).toBe(5_900_000);
    expect(p.categories[0].resteAvant).toBe(400_000);
    expect(p.categories[0].resteApres).toBe(300_000);
    expect(p.categories[0].pctRestantApres).toBe(30);
    expect(p.niveau).toBe("AUCUN");
  });
  it("passe ORANGE puis ROUGE à mesure que le reste baisse", () => {
    expect(previsionBudget(contexte(), [{ categorieId: "cat1", montant: 200_000 }]).niveau).toBe("ORANGE"); // reste 200 000 = 20 %
    expect(previsionBudget(contexte(), [{ categorieId: "cat1", montant: 300_000 }]).niveau).toBe("ROUGE"); // reste 100 000 = 10 %
  });
  it("le niveau le plus grave des deux périmètres l'emporte", () => {
    const c = contexte();
    c.global = { ...c.global!, reserve: 9_500_000 }; // reste global 500 000 ≤ rouge 1 000 000
    const p = previsionBudget(c, [{ categorieId: "cat1", montant: 10_000 }]);
    expect(p.global?.niveau).toBe("ROUGE");
    expect(p.categories[0].niveau).toBe("AUCUN");
    expect(p.niveau).toBe("ROUGE");
  });
  it("additionne les articles d'une même catégorie et compte les articles non catégorisés dans le global seulement", () => {
    const p = previsionBudget(contexte(), [
      { categorieId: "cat1", montant: 50_000 },
      { categorieId: "cat1", montant: 50_000 },
      { categorieId: null, montant: 25_000 },
    ]);
    expect(p.categories).toHaveLength(1);
    expect(p.categories[0].ajout).toBe(100_000);
    expect(p.global?.ajout).toBe(125_000);
  });
  it("catégorie sans budget en vigueur : aucune ligne catégorie", () => {
    const p = previsionBudget(contexte(), [{ categorieId: "autre", montant: 5 }]);
    expect(p.categories).toHaveLength(0);
  });
  it("le dépassement n'est pas plafonné à 0", () => {
    const p = previsionBudget(contexte(), [{ categorieId: "cat1", montant: 500_000 }]);
    expect(p.categories[0].resteApres).toBe(-100_000);
    expect(phrasePerimetre(p.categories[0])).toMatch(/dépassé de 100\s?000 FCFA/);
  });
  it("sans seuil, le reste est calculé mais aucune alerte", () => {
    const c: ContexteBudget = { global: null, categories: { cat1: perimetre({ budget: 100, reserve: 90, seuil: null }) } };
    const p = previsionBudget(c, [{ categorieId: "cat1", montant: 50 }]);
    expect(p.categories[0].resteApres).toBe(-40);
    expect(p.niveau).toBe("AUCUN");
  });
  it("une validation à 0 FCFA n'ajoute aucune alerte", () => {
    const c: ContexteBudget = { global: null, categories: { cat1: perimetre({ budget: 100, reserve: 100 }) } };
    expect(previsionBudget(c, [{ categorieId: "cat1", montant: 0 }]).niveau).toBe("AUCUN");
  });
  it("phrasesAlertes liste les seuls périmètres en alerte", () => {
    const p = previsionBudget(contexte(), [{ categorieId: "cat1", montant: 300_000 }]);
    const phrases = phrasesAlertes(p);
    expect(phrases).toHaveLength(1);
    expect(phrases[0]).toMatch(/^ROUGE — Budget « Informatique »/);
  });
});

describe("verdictBudget — orange, blocage rouge, confirmation du DG", () => {
  const ctx: ContexteBudget = { global: null, categories: { cat1: perimetre({ budget: 1_000_000, reserve: 600_000 }) } };
  const orange = previsionBudget(ctx, [{ categorieId: "cat1", montant: 200_000 }]);
  const rouge = previsionBudget(ctx, [{ categorieId: "cat1", montant: 350_000 }]);
  const vert = previsionBudget(ctx, [{ categorieId: "cat1", montant: 10_000 }]);

  it("sous les seuils : autorisé sans alerte", () => {
    const v = verdictBudget({ prevision: vert, acteurEstDG: false, confirmationExistante: false });
    expect(v).toMatchObject({ autorise: true, alerteOrange: false });
  });
  it("ORANGE : autorisé avec alerte, pour la Finance comme pour le DG", () => {
    expect(verdictBudget({ prevision: orange, acteurEstDG: false, confirmationExistante: false })).toMatchObject({ autorise: true, alerteOrange: true });
    expect(verdictBudget({ prevision: orange, acteurEstDG: true, confirmationExistante: false })).toMatchObject({ autorise: true, alerteOrange: true });
  });
  it("ROUGE : la Finance est bloquée sans confirmation du DG", () => {
    const v = verdictBudget({ prevision: rouge, acteurEstDG: false, confirmationExistante: false });
    expect(v.autorise).toBe(false);
    if (!v.autorise) expect(v.raison).toMatch(/DG/);
  });
  it("ROUGE : un motif saisi par la Finance ne débloque rien (seul le DG confirme)", () => {
    const v = verdictBudget({ prevision: rouge, acteurEstDG: false, motifConfirmation: "motif très détaillé de la finance", confirmationExistante: false });
    expect(v.autorise).toBe(false);
  });
  it("ROUGE : la Finance passe avec une confirmation du DG déjà donnée", () => {
    const v = verdictBudget({ prevision: rouge, acteurEstDG: false, confirmationExistante: true });
    expect(v).toMatchObject({ autorise: true, utiliseConfirmationExistante: true });
  });
  it("ROUGE : le DG confirme lui-même dans le même geste, motif obligatoire (≥ 10 caractères)", () => {
    expect(verdictBudget({ prevision: rouge, acteurEstDG: true, confirmationExistante: false }).autorise).toBe(false);
    expect(verdictBudget({ prevision: rouge, acteurEstDG: true, motifConfirmation: "court", confirmationExistante: false }).autorise).toBe(false);
    const v = verdictBudget({ prevision: rouge, acteurEstDG: true, motifConfirmation: "  Achat urgent validé en comité  ", confirmationExistante: false });
    expect(v).toMatchObject({ autorise: true, motifConfirme: "Achat urgent validé en comité" });
  });
});

describe("budgets existants repris par la migration", () => {
  it("validé par le DG, sans date de fin, seuil par défaut", () => {
    const r = parametrageDepuisBudgetExistant("cat1", 2_500_000);
    expect(r).toEqual({
      portee: "CATEGORIE",
      categorieId: "cat1",
      montant: 2_500_000,
      dateDebut: DATE_DEBUT_BUDGET_REPRIS,
      dateFin: null,
      seuil: { mode: "POURCENTAGE", orange: 20, rouge: 0 },
      statut: "VALIDE",
    });
  });
  it("le paramétrage repris est en vigueur aujourd'hui et sa consommation passée reste comptée (début en 2000)", () => {
    const r = parametrageDepuisBudgetExistant("cat1", 100);
    const p: ParametrageBudget = { id: "m", ...r };
    expect(budgetEnVigueur([p], "CATEGORIE", "cat1", "2026-10-19")?.id).toBe("m");
    expect(r.dateDebut < "2020-01-01").toBe(true);
  });
  it("ne bloque rien au déploiement : un budget repris non épuisé n'est jamais ROUGE", () => {
    const ctx: ContexteBudget = { global: null, categories: { cat1: perimetre({ budget: 1000, reserve: 500, seuil: { ...SEUIL_BUDGET_PAR_DEFAUT } }) } };
    expect(previsionBudget(ctx, [{ categorieId: "cat1", montant: 100 }]).niveau).toBe("AUCUN");
    expect(previsionBudget(ctx, [{ categorieId: "cat1", montant: 350 }]).niveau).toBe("ORANGE");
  });
});

describe("photo du budget après validation d'un article", () => {
  const ctx: ContexteBudget = {
    global: perimetre({ parametrageId: "g", portee: "GLOBAL", categorieId: null, libelle: "Global", budget: 10_000_000, reserve: 4_000_000, seuil: null }),
    categories: { cat1: perimetre({ budget: 1_000_000, reserve: 600_000 }), cat2: perimetre({ categorieId: "cat2", libelle: "Carburant", budget: 500_000, reserve: 0 }) },
  };
  it("garde le global et SA catégorie seulement", () => {
    const prevision = previsionBudget(ctx, [{ categorieId: "cat1", montant: 200_000 }, { categorieId: "cat2", montant: 10_000 }]);
    const snap = snapshotBudgetLigne(prevision, "cat1")!;
    expect(snap.global?.resteApres).toBe(5_790_000);
    expect(snap.categorie?.libelle).toBe("Informatique");
    expect(snap.categorie?.resteApres).toBe(200_000);
    expect(snap.niveau).toBe("ORANGE");
    expect(phrasesSnapshotBudget(snap)).toHaveLength(2);
    expect(phrasesSnapshotBudget(snap)[1]).toMatch(/Budget « Informatique » : reste 200\s?000 FCFA \(20 % de 1\s?000\s?000 FCFA\) — alerte orange/);
  });
  it("aucune photo sans budget concerné", () => {
    expect(snapshotBudgetLigne(previsionBudget({ global: null, categories: {} }, [{ categorieId: "cat1", montant: 5 }]), "cat1")).toBeNull();
  });
  it("relecture tolérante d'un JSON inattendu", () => {
    expect(lireSnapshotBudget(null)).toBeNull();
    expect(lireSnapshotBudget({ global: 3 })).toBeNull();
    const prevision = previsionBudget(ctx, [{ categorieId: "cat1", montant: 1 }]);
    const snap = snapshotBudgetLigne(prevision, "cat1")!;
    expect(lireSnapshotBudget(JSON.parse(JSON.stringify(snap)))).toEqual(snap);
  });
});

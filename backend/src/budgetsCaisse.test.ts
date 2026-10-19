import { describe, expect, it } from "vitest";

import {
  budgetEnVigueur,
  convertirParametrageGlobalLotJ,
  LIBELLE_SOLDE_CAISSE,
  lireSnapshotBudget,
  perimetreCaisse,
  phrasePerimetre,
  phrasesAlertes,
  phrasesSnapshotBudget,
  previsionBudget,
  SEUIL_CAISSE_PAR_DEFAUT,
  snapshotBudgetLigne,
  validerLotParametrages,
  validerSaisieParametrage,
  verdictBudget,
  type ContexteBudget,
  type DetailCaisse,
  type ParametrageBudget,
  type SaisieParametrage,
  type SeuilBudget,
} from "./budgets";

const AUJOURDHUI = "2026-10-20";
const SEUIL: SeuilBudget = { mode: "MONTANT", orange: 2_000_000, rouge: 500_000 };

const parametrageGlobal = (p: Partial<ParametrageBudget> = {}): ParametrageBudget => ({
  id: "g1",
  portee: "GLOBAL",
  categorieId: null,
  montant: null,
  dateDebut: "2026-10-01",
  dateFin: null,
  seuil: SEUIL,
  statut: "VALIDE",
  ...p,
});

const caisse = (d: Partial<DetailCaisse> = {}): DetailCaisse => ({ soldeCaisse: 10_000_000, engageCaisseConnu: 0, engageModeInconnu: 0, ...d });

const contexte = (d: Partial<DetailCaisse> = {}, p: ParametrageBudget | null = parametrageGlobal()): ContexteBudget => ({
  global: perimetreCaisse(caisse(d), p),
  categories: {},
});

describe("budget global = solde de caisse réel (périmètre)", () => {
  it("le budget est le solde de caisse, la réserve est l'engagé non sorti de la caisse", () => {
    const p = perimetreCaisse(caisse({ soldeCaisse: 4_000_000, engageCaisseConnu: 300_000, engageModeInconnu: 700_000 }), parametrageGlobal());
    expect(p.portee).toBe("GLOBAL");
    expect(p.libelle).toBe(LIBELLE_SOLDE_CAISSE);
    expect(p.budget).toBe(4_000_000);
    expect(p.reserve).toBe(1_000_000);
    expect(p.caisse).toEqual({ soldeCaisse: 4_000_000, engageCaisseConnu: 300_000, engageModeInconnu: 700_000 });
  });
  it("sans paramétrage en vigueur le solde s'affiche mais aucun seuil ne s'applique", () => {
    const p = perimetreCaisse(caisse(), null);
    expect(p.parametrageId).toBeNull();
    expect(p.seuil).toBeNull();
    expect(p.budget).toBe(10_000_000);
  });
  it("un seuil en pourcentage hérité est ignoré (aucun total de référence)", () => {
    const p = perimetreCaisse(caisse(), parametrageGlobal({ seuil: { mode: "POURCENTAGE", orange: 20, rouge: 10 } }));
    expect(p.seuil).toBeNull();
  });
  it("centimes exacts sur la réserve", () => {
    const p = perimetreCaisse(caisse({ engageCaisseConnu: 0.1, engageModeInconnu: 0.2 }), parametrageGlobal());
    expect(p.reserve).toBe(0.3);
  });
});

describe("prévisionnel du budget global = solde de caisse − engagé − validation en cours", () => {
  it("reste après = solde − engagé − montant validé (sans plafonner)", () => {
    const c = contexte({ soldeCaisse: 5_000_000, engageCaisseConnu: 200_000, engageModeInconnu: 800_000 });
    const p = previsionBudget(c, [{ categorieId: null, montant: 1_000_000 }]);
    expect(p.global?.resteAvant).toBe(4_000_000);
    expect(p.global?.resteApres).toBe(3_000_000);
    expect(p.global?.pctRestantApres).toBe(0); // pas de pourcentage pour un solde de caisse
    expect(p.global?.caisse).toEqual({ soldeCaisse: 5_000_000, engageCaisseConnu: 200_000, engageModeInconnu: 800_000 });
    expect(p.niveau).toBe("AUCUN");
  });
  it("tous les articles validés ensemble comptent dans le global, catégorisés ou non", () => {
    const c = contexte();
    const p = previsionBudget(c, [
      { categorieId: "cat1", montant: 100_000 },
      { categorieId: null, montant: 50_000 },
    ]);
    expect(p.global?.ajout).toBe(150_000);
  });
  it("ORANGE quand le solde prévisionnel atteint le seuil orange (inclus)", () => {
    const p = previsionBudget(contexte({ soldeCaisse: 3_000_000 }), [{ categorieId: null, montant: 1_000_000 }]); // reste 2 000 000
    expect(p.global?.niveau).toBe("ORANGE");
    expect(p.niveau).toBe("ORANGE");
  });
  it("ROUGE quand le solde prévisionnel atteint le seuil rouge (inclus)", () => {
    const p = previsionBudget(contexte({ soldeCaisse: 3_000_000 }), [{ categorieId: null, montant: 2_500_000 }]); // reste 500 000
    expect(p.global?.niveau).toBe("ROUGE");
  });
  it("solde prévisionnel NÉGATIF : rouge (dès qu'un seuil est en vigueur), non plafonné à 0", () => {
    const p = previsionBudget(contexte({ soldeCaisse: 1_000_000 }), [{ categorieId: null, montant: 1_500_000 }]);
    expect(p.global?.resteApres).toBe(-500_000);
    expect(p.global?.niveau).toBe("ROUGE");
    expect(phrasePerimetre(p.global!)).toMatch(/NÉGATIF de 500\s?000 FCFA/);
  });
  it("solde de caisse négatif avant même la validation : rouge", () => {
    const p = previsionBudget(contexte({ soldeCaisse: -100 }), [{ categorieId: null, montant: 1 }]);
    expect(p.global?.niveau).toBe("ROUGE");
  });
  it("sans seuil global validé : le reste s'affiche, jamais d'alerte, même négatif", () => {
    const p = previsionBudget(contexte({ soldeCaisse: 100_000 }, null), [{ categorieId: null, montant: 900_000 }]);
    expect(p.global?.resteApres).toBe(-800_000);
    expect(p.global?.niveau).toBe("AUCUN");
    expect(p.niveau).toBe("AUCUN");
  });
  it("une validation à 0 FCFA n'ajoute aucune alerte", () => {
    const p = previsionBudget(contexte({ soldeCaisse: 100 }), [{ categorieId: null, montant: 0 }]);
    expect(p.global?.niveau).toBe("AUCUN");
  });
  it("un règlement banque ou en caisse déjà confirmé n'est pas dans l'engagé : seul le journal fait foi pour le solde", () => {
    // 1 000 000 validé non réglé engagé ; le solde réel du journal reste 5 000 000 : reste = 4 000 000
    const p = previsionBudget(contexte({ soldeCaisse: 5_000_000, engageModeInconnu: 1_000_000 }), []);
    expect(p.global).not.toBeNull();
    const avecAjout = previsionBudget(contexte({ soldeCaisse: 5_000_000, engageModeInconnu: 1_000_000 }), [{ categorieId: null, montant: 1 }]);
    expect(avecAjout.global?.resteAvant).toBe(4_000_000);
  });
  it("phrase d'alerte : solde de caisse prévisionnel et solde actuel", () => {
    const p = previsionBudget(contexte({ soldeCaisse: 3_000_000 }), [{ categorieId: null, montant: 1_000_000 }]);
    const phrase = phrasePerimetre(p.global!);
    expect(phrase).toMatch(/Solde de caisse prévisionnel : 2\s?000\s?000 FCFA après cette validation \(solde actuel 3\s?000\s?000 FCFA\)/);
    expect(phrasesAlertes(p)[0]).toMatch(/^ORANGE — Solde de caisse prévisionnel/);
  });
});

describe("verdict : le blocage rouge du global suit la règle du lot J", () => {
  const rouge = () => previsionBudget(contexte({ soldeCaisse: 1_000_000 }), [{ categorieId: null, montant: 900_000 }]); // reste 100 000 ≤ 500 000
  it("orange : validation permise", () => {
    const p = previsionBudget(contexte({ soldeCaisse: 3_000_000 }), [{ categorieId: null, montant: 1_000_000 }]);
    const v = verdictBudget({ prevision: p, acteurEstDG: false, confirmationExistante: false });
    expect(v.autorise).toBe(true);
    if (v.autorise) expect(v.alerteOrange).toBe(true);
  });
  it("rouge : bloquée pour la Finance sans confirmation du DG", () => {
    const v = verdictBudget({ prevision: rouge(), acteurEstDG: false, confirmationExistante: false });
    expect(v.autorise).toBe(false);
  });
  it("rouge : le DG confirme dans le même geste avec un motif d'au moins 10 caractères", () => {
    expect(verdictBudget({ prevision: rouge(), acteurEstDG: true, motifConfirmation: "court", confirmationExistante: false }).autorise).toBe(false);
    expect(verdictBudget({ prevision: rouge(), acteurEstDG: true, motifConfirmation: "Alimentation de caisse prévue demain", confirmationExistante: false }).autorise).toBe(true);
  });
  it("rouge : passe avec une confirmation du DG déjà donnée", () => {
    const v = verdictBudget({ prevision: rouge(), acteurEstDG: false, confirmationExistante: true });
    expect(v.autorise).toBe(true);
  });
});

describe("saisie du paramétrage global : seuils en montant uniquement, aucun montant", () => {
  const global = (extra: Partial<SaisieParametrage> = {}): SaisieParametrage => ({
    portee: "GLOBAL",
    dateDebut: AUJOURDHUI,
    seuil: { mode: "MONTANT", orange: 2_000_000, rouge: 500_000 },
    ...extra,
  });
  it("accepte des seuils en montant sans montant de budget", () => {
    const r = validerSaisieParametrage(global(), AUJOURDHUI);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valeur.montant).toBeNull();
      expect(r.valeur.categorieId).toBeNull();
      expect(r.valeur.seuil).toEqual({ mode: "MONTANT", orange: 2_000_000, rouge: 500_000 });
    }
  });
  it("ignore un montant envoyé par le client (le solde de caisse réel fait foi)", () => {
    const r = validerSaisieParametrage(global({ montant: 99 }), AUJOURDHUI);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valeur.montant).toBeNull();
  });
  it("refuse un pourcentage", () => {
    const r = validerSaisieParametrage(global({ seuil: { mode: "POURCENTAGE", orange: 20, rouge: 10 } }), AUJOURDHUI);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs.seuilMode).toMatch(/montant/);
  });
  it("refuse l'absence de seuil", () => {
    const r = validerSaisieParametrage(global({ seuil: null }), AUJOURDHUI);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs.seuilMode).toBeDefined();
  });
  it("refuse un rouge qui n'est pas strictement plus bas que l'orange", () => {
    const r = validerSaisieParametrage(global({ seuil: { mode: "MONTANT", orange: 100, rouge: 100 } }), AUJOURDHUI);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs.seuilRouge).toBeDefined();
  });
  it("accepte un rouge à 0 (solde épuisé) et refuse un seuil négatif", () => {
    expect(validerSaisieParametrage(global({ seuil: { mode: "MONTANT", orange: 100_000, rouge: 0 } }), AUJOURDHUI).ok).toBe(true);
    expect(validerSaisieParametrage(global({ seuil: { mode: "MONTANT", orange: 100, rouge: -1 } }), AUJOURDHUI).ok).toBe(false);
  });
  it("le seuil orange n'est pas borné par un « budget » : un solde de caisse peut dépasser tout montant saisi", () => {
    expect(validerSaisieParametrage(global({ seuil: { mode: "MONTANT", orange: 900_000_000, rouge: 1 } }), AUJOURDHUI).ok).toBe(true);
  });
  it("date d'effet : jamais dans le passé, fin facultative non antérieure au début", () => {
    expect(validerSaisieParametrage(global({ dateDebut: "2026-10-19" }), AUJOURDHUI).ok).toBe(false);
    expect(validerSaisieParametrage(global({ dateFin: "2026-10-19" }), AUJOURDHUI).ok).toBe(false);
    expect(validerSaisieParametrage(global({ dateFin: "2026-12-31" }), AUJOURDHUI).ok).toBe(true);
  });
  it("une catégorie reste inchangée : montant obligatoire, pourcentage ou montant", () => {
    const base = { portee: "CATEGORIE" as const, categorieId: "cat1", dateDebut: AUJOURDHUI };
    expect(validerSaisieParametrage({ ...base, seuil: { mode: "POURCENTAGE", orange: 20, rouge: 10 } }, AUJOURDHUI).ok).toBe(false); // montant manquant
    expect(validerSaisieParametrage({ ...base, montant: 1_000_000, seuil: { mode: "POURCENTAGE", orange: 20, rouge: 10 } }, AUJOURDHUI).ok).toBe(true);
    expect(validerSaisieParametrage({ ...base, montant: 1_000_000, seuil: { mode: "MONTANT", orange: 300_000, rouge: 100_000 } }, AUJOURDHUI).ok).toBe(true);
    expect(validerSaisieParametrage({ ...base, montant: 1_000_000, seuil: { mode: "MONTANT", orange: 2_000_000, rouge: 100_000 } }, AUJOURDHUI).ok).toBe(false);
  });
});

describe("soumission en lot : tout ou rien", () => {
  const cat = (id: string, extra: Partial<SaisieParametrage> = {}): SaisieParametrage => ({
    portee: "CATEGORIE",
    categorieId: id,
    montant: 1_000_000,
    dateDebut: AUJOURDHUI,
    seuil: { mode: "POURCENTAGE", orange: 20, rouge: 10 },
    ...extra,
  });
  const glob = (): SaisieParametrage => ({ portee: "GLOBAL", dateDebut: AUJOURDHUI, seuil: { mode: "MONTANT", orange: 2_000_000, rouge: 500_000 } });

  it("accepte plusieurs catégories avec les seuils globaux", () => {
    const r = validerLotParametrages([cat("a"), cat("b"), glob()], AUJOURDHUI);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valeurs).toHaveLength(3);
      expect(r.valeurs.filter((v) => v.portee === "GLOBAL")).toHaveLength(1);
    }
  });
  it("une sélection vide est refusée", () => {
    const r = validerLotParametrages([], AUJOURDHUI);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Cochez/);
  });
  it("une seule saisie incohérente refuse tout le lot et indique la ligne fautive", () => {
    const r = validerLotParametrages([cat("a"), cat("b", { montant: 0 }), glob()], AUJOURDHUI);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.erreursParIndex)).toEqual(["1"]);
      expect(r.erreursParIndex[1].montant).toBeDefined();
    }
  });
  it("la même catégorie deux fois, ou le global deux fois, est refusé", () => {
    const r = validerLotParametrages([cat("a"), cat("a")], AUJOURDHUI);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreursParIndex[1].categorieId).toMatch(/déjà/);
    expect(validerLotParametrages([glob(), glob()], AUJOURDHUI).ok).toBe(false);
  });
});

describe("paramétrage global en vigueur : un nouveau remplace l'ancien à sa date d'effet", () => {
  it("le global en attente ou refusé n'est jamais pris en compte", () => {
    const liste = [parametrageGlobal({ id: "a", statut: "EN_ATTENTE" }), parametrageGlobal({ id: "b", statut: "REFUSE" })];
    expect(budgetEnVigueur(liste, "GLOBAL", null, "2026-10-20")).toBeNull();
  });
  it("le plus récent début gagne, l'ancien reste dans l'historique", () => {
    const ancien = parametrageGlobal({ id: "ancien", dateDebut: "2026-10-01" });
    const nouveau = parametrageGlobal({ id: "nouveau", dateDebut: "2026-11-01", seuil: { mode: "MONTANT", orange: 9, rouge: 1 } });
    expect(budgetEnVigueur([ancien, nouveau], "GLOBAL", null, "2026-10-20")?.id).toBe("ancien");
    expect(budgetEnVigueur([ancien, nouveau], "GLOBAL", null, "2026-11-01")?.id).toBe("nouveau");
  });
});

describe("migration des paramétrages globaux du lot J", () => {
  it("le montant saisi est ignoré", () => {
    const r = convertirParametrageGlobalLotJ({ montant: 50_000_000, seuil: { mode: "MONTANT", orange: 5, rouge: 1 } as SeuilBudget | null });
    expect(r.montant).toBeNull();
  });
  it("un seuil en montant est conservé tel quel", () => {
    const seuil: SeuilBudget = { mode: "MONTANT", orange: 3_000_000, rouge: 1_000_000 };
    expect(convertirParametrageGlobalLotJ({ montant: 1, seuil }).seuil).toEqual(seuil);
  });
  it("un seuil en pourcentage devient le seuil par défaut documenté", () => {
    const r = convertirParametrageGlobalLotJ({ montant: 1, seuil: { mode: "POURCENTAGE", orange: 20, rouge: 10 } as SeuilBudget | null });
    expect(r.seuil).toEqual(SEUIL_CAISSE_PAR_DEFAUT);
    expect(SEUIL_CAISSE_PAR_DEFAUT).toEqual({ mode: "MONTANT", orange: 100_000, rouge: 0 });
  });
  it("sans seuil : aucune alerte globale (rien n'est inventé)", () => {
    expect(convertirParametrageGlobalLotJ({ montant: 1, seuil: null as SeuilBudget | null }).seuil).toBeNull();
  });
  it("est idempotente (rejouable sans effet)", () => {
    const une = convertirParametrageGlobalLotJ({ montant: 10, seuil: { mode: "POURCENTAGE", orange: 20, rouge: 10 } as SeuilBudget | null });
    expect(convertirParametrageGlobalLotJ(une)).toEqual(une);
  });
  it("le seuil par défaut ne bloque rien tant que la caisse n'est pas à sec", () => {
    const c = contexte({ soldeCaisse: 4_000_000 }, parametrageGlobal({ seuil: SEUIL_CAISSE_PAR_DEFAUT }));
    expect(previsionBudget(c, [{ categorieId: null, montant: 1_000_000 }]).niveau).toBe("AUCUN");
    expect(previsionBudget(c, [{ categorieId: null, montant: 3_950_000 }]).niveau).toBe("ORANGE");
    expect(previsionBudget(c, [{ categorieId: null, montant: 4_000_000 }]).niveau).toBe("ROUGE");
  });
});

describe("photo du budget : le global est le solde de caisse prévisionnel", () => {
  it("la photo et son texte parlent du solde de caisse", () => {
    const p = previsionBudget(contexte({ soldeCaisse: 3_000_000 }), [{ categorieId: null, montant: 1_000_000 }]);
    const snap = snapshotBudgetLigne(p, null);
    expect(snap?.global?.resteApres).toBe(2_000_000);
    const relu = lireSnapshotBudget(JSON.parse(JSON.stringify(snap)));
    expect(phrasesSnapshotBudget(relu!)[0]).toMatch(/^Solde de caisse prévisionnel : 2\s?000\s?000 FCFA — alerte orange$/);
  });
  it("solde négatif", () => {
    const p = previsionBudget(contexte({ soldeCaisse: 100 }), [{ categorieId: null, montant: 600 }]);
    const snap = snapshotBudgetLigne(p, null)!;
    expect(phrasesSnapshotBudget(snap)[0]).toMatch(/^Solde de caisse prévisionnel négatif de 500 FCFA — alerte rouge$/);
  });
});

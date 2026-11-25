import { describe, expect, it } from "vitest";
import {
  baseAvanceCpt,
  calculerAvanceCpt,
  casTaxeCpt,
  moisImputationLigneCpt,
  montantsImputationCpt,
  montantsRattachementCpt,
  partProrataCpt,
  planifierTaxeRattachementCpt,
  taxeContenueCpt,
  tauxApplicableCpt,
} from "./cptTaxe";
import type { TauxTcaLigne } from "./cptReferentiels";

const fcfa = (n: number) => BigInt(n) * BigInt(100);
const unites = (c: bigint | null) => (c === null ? null : Number(c / BigInt(100)));

const TAUX: TauxTcaLigne[] = [
  { id: "t1", branche: "ACCIDENTS", produitCode: null, natureContrat: null, taux: "0.072500", dateEffet: "2000-01-01" },
  { id: "t2", branche: "SANTE", produitCode: null, natureContrat: "GROUPE", taux: "0.015000", dateEffet: "2000-01-01" },
  { id: "t3", branche: "SANTE", produitCode: null, natureContrat: "INDIVIDUEL", taux: "0.040000", dateEffet: "2000-01-01" },
  { id: "t4", branche: "INCENDIE", produitCode: null, natureContrat: null, taux: "0.125000", dateEffet: "2000-01-01" },
  { id: "t5", branche: "DECES", produitCode: null, natureContrat: null, taux: "0.000000", dateEffet: "2000-01-01" },
];

describe("taxe contenue : le tableau des cinq taux sur 2 500 FCFA (plan 7.1)", () => {
  it.each([
    ["Accidents 7,25 %", "0.0725", 169],
    ["Santé groupe 1,5 %", "0.015", 37],
    ["Santé individuelle 4 %", "0.04", 96],
    ["Incendie 12,5 %", "0.125", 278],
    ["Décès 0 %", "0", 0],
  ])("%s → %i", (_nom, taux, attendu) => {
    expect(unites(taxeContenueCpt(fcfa(2500), taux))).toBe(attendu);
  });

  it("les taux du référentiel donnent les mêmes résultats par branche", () => {
    const cas: [Parameters<typeof tauxApplicableCpt>[1], number][] = [
      [{ branche: "ACCIDENTS", produitCode: "RELAXMOTO", natureContrat: "INDIVIDUEL", date: "2026-11-10" }, 169],
      [{ branche: "SANTE", produitCode: "SANTE-G", natureContrat: "GROUPE", date: "2026-11-10" }, 37],
      [{ branche: "SANTE", produitCode: "SANTE-I", natureContrat: "INDIVIDUEL", date: "2026-11-10" }, 96],
      [{ branche: "INCENDIE", produitCode: "INC", natureContrat: null, date: "2026-11-10" }, 278],
      [{ branche: "DECES", produitCode: "DC", natureContrat: null, date: "2026-11-10" }, 0],
    ];
    for (const [critere, attendu] of cas) {
      const t = tauxApplicableCpt(TAUX, critere);
      expect(t).not.toBeNull();
      expect(unites(taxeContenueCpt(fcfa(2500), t!.taux))).toBe(attendu);
    }
  });

  it("un taux invalide ne donne rien", () => {
    expect(taxeContenueCpt(fcfa(100), "7,25 %")).toBeNull();
    expect(taxeContenueCpt(fcfa(100), "1.5")).toBeNull();
  });
});

describe("taux applicable", () => {
  it("le taux du contrat (SECURPRO) l'emporte sur le référentiel", () => {
    const t = tauxApplicableCpt(TAUX, { branche: "INCENDIE", produitCode: "SECURPRO", natureContrat: null, date: "2026-11-10", tauxContrat: "0.08" });
    expect(t).toEqual({ taux: "0.08", source: "CONTRAT" });
  });
  it("aucun taux : jamais zéro deviné", () => {
    expect(tauxApplicableCpt([], { branche: "INCENDIE", produitCode: null, natureContrat: null, date: "2026-11-10" })).toBeNull();
  });
  it("un taux futur n'est pas encore en vigueur", () => {
    const futur: TauxTcaLigne[] = [{ id: "f", branche: "INCENDIE", produitCode: null, natureContrat: null, taux: "0.2", dateEffet: "2027-01-01" }];
    expect(tauxApplicableCpt(futur, { branche: "INCENDIE", produitCode: null, natureContrat: null, date: "2026-12-31" })).toBeNull();
  });
});

describe("les cinq cas", () => {
  it("classe chaque part d'encaissement", () => {
    expect(casTaxeCpt({ pasUnePrime: false, rattache: true, contratConnu: true, produitConnu: true })).toBe("RATTACHE");
    expect(casTaxeCpt({ pasUnePrime: false, rattache: false, contratConnu: false, produitConnu: true })).toBe("SANS_CONTRAT");
    expect(casTaxeCpt({ pasUnePrime: false, rattache: false, contratConnu: true, produitConnu: true })).toBe("CONTRAT_NON_RATTACHE");
    expect(casTaxeCpt({ pasUnePrime: false, rattache: false, contratConnu: false, produitConnu: false })).toBe("NON_IDENTIFIE");
    expect(casTaxeCpt({ pasUnePrime: true, rattache: true, contratConnu: true, produitConnu: true })).toBe("PAS_UNE_PRIME");
  });
});

describe("T1 : 4 500 payés dont 2 000 de frais de carte santé (RELAXMOTO 2 500 par mois)", () => {
  const echeance = { montantDu: fcfa(2500), taxe: fcfa(169), accessoires: ZERO_ACC() };
  it("la taxe porte sur 2 500 seulement", () => {
    const m = montantsRattachementCpt(echeance, { montant: fcfa(2500), dejaValideSurEcheance: BigInt(0), taxeDejaAttribuee: BigInt(0), accessoiresDejaAttribues: BigInt(0) });
    expect(unites(m.taxe)).toBe(169);
    expect(unites(m.base)).toBe(2500);
  });
  it("les 2 000 « pas une prime » n'ont aucune base taxable", () => {
    expect(unites(baseAvanceCpt(fcfa(4500), fcfa(2000)))).toBe(2500);
    expect(baseAvanceCpt(fcfa(2000), fcfa(2000))).toBe(BigInt(0));
    const r = calculerAvanceCpt(baseAvanceCpt(fcfa(2000), fcfa(2000)), "0.0725");
    expect(r).toEqual({ ok: false, motif: "BASE_NULLE" });
  });
});

describe("T3 : groupe santé, échéances de 50 000 à 1,5 %", () => {
  it("taxe de l'échéance et du premier paiement", () => {
    const taxeEcheance = taxeContenueCpt(fcfa(50000), "0.015")!;
    expect(unites(taxeEcheance)).toBe(739);
    const m = montantsRattachementCpt({ montantDu: fcfa(50000), taxe: taxeEcheance, accessoires: BigInt(0) }, { montant: fcfa(50000), dejaValideSurEcheance: BigInt(0), taxeDejaAttribuee: BigInt(0), accessoiresDejaAttribues: BigInt(0) });
    expect(unites(m.taxe)).toBe(739);
  });
});

describe("T5 : 1 500 sans contrat, INDIVIDUELLE CONDUCTEUR (7,25 %)", () => {
  const avance = calculerAvanceCpt(fcfa(1500), "0.0725");
  it("avance de 101 dans le mois", () => {
    expect(avance.ok && unites(avance.ligne.taxe)).toBe(101);
  });
  it("au rattachement la taxe n'est PAS redemandée : l'imputation annule l'avance", () => {
    if (!avance.ok) throw new Error("avance attendue");
    const plan = planifierTaxeRattachementCpt({
      echeance: { montantDu: fcfa(1500), taxe: fcfa(101), accessoires: BigInt(0) },
      rattachement: { montant: fcfa(1500), dejaValideSurEcheance: BigInt(0), taxeDejaAttribuee: BigInt(0), accessoiresDejaAttribues: BigInt(0) },
      taux: "0.0725",
      avance: { id: "av", taux: "0.0725", base: avance.ligne.base, taxe: avance.ligne.taxe, primeHt: avance.ligne.primeHt, baseDejaImputee: BigInt(0), taxeDejaImputee: BigInt(0), primeHtDejaImputee: BigInt(0) },
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.lignes.map((l) => l.origine)).toEqual(["RATTACHEMENT", "IMPUTATION"]);
    const net = plan.lignes.reduce((s, l) => s + l.taxe, BigInt(0));
    expect(unites(net)).toBe(0);
    const baseNette = plan.lignes.reduce((s, l) => s + l.base, BigInt(0));
    expect(baseNette).toBe(BigInt(0));
    expect(plan.lignes[1].ligneAvanceId).toBe("av");
  });
  it("un écart de taxe devient la différence, jamais une réécriture", () => {
    if (!avance.ok) throw new Error("avance attendue");
    const plan = planifierTaxeRattachementCpt({
      echeance: { montantDu: fcfa(1500), taxe: fcfa(110), accessoires: BigInt(0) },
      rattachement: { montant: fcfa(1500), dejaValideSurEcheance: BigInt(0), taxeDejaAttribuee: BigInt(0), accessoiresDejaAttribues: BigInt(0) },
      taux: "0.0725",
      avance: { id: "av", taux: "0.0725", base: avance.ligne.base, taxe: avance.ligne.taxe, primeHt: avance.ligne.primeHt, baseDejaImputee: BigInt(0), taxeDejaImputee: BigInt(0), primeHtDejaImputee: BigInt(0) },
    });
    if (!plan.ok) throw new Error("plan attendu");
    expect(unites(plan.lignes.reduce((s, l) => s + l.taxe, BigInt(0)))).toBe(9);
  });
});

describe("prorata et reliquat exact (D4)", () => {
  it("trois paiements d'une échéance de 10 000 dont la taxe est 725 : le dernier reçoit le reliquat", () => {
    const e = { montantDu: fcfa(10000), taxe: fcfa(725), accessoires: BigInt(0) };
    const un = montantsRattachementCpt(e, { montant: fcfa(3333), dejaValideSurEcheance: BigInt(0), taxeDejaAttribuee: BigInt(0), accessoiresDejaAttribues: BigInt(0) });
    const deux = montantsRattachementCpt(e, { montant: fcfa(3333), dejaValideSurEcheance: fcfa(3333), taxeDejaAttribuee: un.taxe, accessoiresDejaAttribues: BigInt(0) });
    const trois = montantsRattachementCpt(e, { montant: fcfa(3334), dejaValideSurEcheance: fcfa(6666), taxeDejaAttribuee: un.taxe + deux.taxe, accessoiresDejaAttribues: BigInt(0) });
    expect(unites(un.taxe)).toBe(242);
    expect(unites(un.taxe + deux.taxe + trois.taxe)).toBe(725);
  });
  it("jamais plus que ce qui reste de la taxe de l'échéance", () => {
    expect(unites(partProrataCpt({ total: fcfa(100), montant: fcfa(90), montantDu: fcfa(100), dejaAttribue: fcfa(50), solde: false }))).toBe(50);
  });
  it("accessoires au prorata, prime hors taxe = reste", () => {
    const m = montantsRattachementCpt({ montantDu: fcfa(1000), taxe: fcfa(70), accessoires: fcfa(100) }, { montant: fcfa(1000), dejaValideSurEcheance: BigInt(0), taxeDejaAttribuee: BigInt(0), accessoiresDejaAttribues: BigInt(0) });
    expect([unites(m.taxe), unites(m.accessoiresHt), unites(m.primeHt)]).toEqual([70, 100, 830]);
  });
});

describe("imputation partielle d'une avance", () => {
  const base = { base: fcfa(1500), taxe: fcfa(101), primeHt: fcfa(1399), baseDejaImputee: BigInt(0), taxeDejaImputee: BigInt(0), primeHtDejaImputee: BigInt(0) };
  it("deux rattachements consomment toute l'avance, au centime", () => {
    const a = montantsImputationCpt(base, fcfa(1000))!;
    const b = montantsImputationCpt({ ...base, baseDejaImputee: -a.base, taxeDejaImputee: -a.taxe, primeHtDejaImputee: -a.primeHt }, fcfa(500))!;
    expect(unites(-(a.taxe + b.taxe))).toBe(101);
    expect(unites(-(a.base + b.base))).toBe(1500);
  });
  it("rien à imputer une fois l'avance consommée", () => {
    expect(montantsImputationCpt({ ...base, baseDejaImputee: fcfa(1500) }, fcfa(10))).toBeNull();
  });
});

describe("taux manquant", () => {
  it("aucune ligne, jamais un zéro deviné", () => {
    expect(calculerAvanceCpt(fcfa(1000), null)).toEqual({ ok: false, motif: "TAUX_MANQUANT" });
    const plan = planifierTaxeRattachementCpt({
      echeance: { montantDu: fcfa(1000), taxe: fcfa(70), accessoires: BigInt(0) },
      rattachement: { montant: fcfa(1000), dejaValideSurEcheance: BigInt(0), taxeDejaAttribuee: BigInt(0), accessoiresDejaAttribues: BigInt(0) },
      taux: null,
    });
    expect(plan).toEqual({ ok: false, motif: "TAUX_MANQUANT" });
  });
});

describe("mois d'une ligne (C-3)", () => {
  it("le mois de la date de valeur", () => {
    expect(moisImputationLigneCpt("2026-02-17", null)).toBe("2026-02-01");
  });
  it("un mois déjà déclaré renvoie au premier mois ouvert", () => {
    expect(moisImputationLigneCpt("2026-02-17", "2026-02-01")).toBe("2026-03-01");
    expect(moisImputationLigneCpt("2026-01-05", "2026-12-01")).toBe("2027-01-01");
  });
  it("une date postérieure au dernier mois déclaré garde son mois", () => {
    expect(moisImputationLigneCpt("2026-06-30", "2026-02-01")).toBe("2026-06-01");
  });
});

function ZERO_ACC(): bigint {
  return BigInt(0);
}

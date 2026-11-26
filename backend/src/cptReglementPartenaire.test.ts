import { describe, expect, it } from "vitest";

import { capaciteReglementCpt, planifierReglementCpt, validerSaisieReglementCpt } from "./cptReglementPartenaire";
import { payeDecideEnUneFoisCpt, type LigneRemunerationCalculeeCpt } from "./cptRemuneration";

const F = (fcfa: number) => BigInt(fcfa) * BigInt(100);
const Z = BigInt(0);

/** Ligne de commission « au prorata » : dû 1 000, exigible à l'émission, payable selon la part encaissée de la prime (10 000). */
function ligne(rang: number, encaisse: number, p: Partial<LigneRemunerationCalculeeCpt> = {}): LigneRemunerationCalculeeCpt {
  const du = p.du ?? F(1000);
  const paye = p.paye ?? Z;
  const payable = p.payable ?? (BigInt(encaisse) * du) / BigInt(10000);
  const max0 = (x: bigint) => (x > Z ? x : Z);
  return {
    cle: `${p.numPolice ?? "POL-1"}|${rang}`,
    ligneId: null,
    contratId: p.numPolice ?? "POL-1",
    numPolice: "POL-1",
    echeanceId: `e${rang}`,
    rang,
    datePrevue: `2026-${String(rang).padStart(2, "0")}-01`,
    beneficiaireId: "courtier",
    nature: "COMMISSION",
    conventionId: "cv",
    faitGenerateur: "EMISSION",
    mode: "AU_PRORATA",
    modeDecide: false,
    payeEnUneFois: Z,
    primeDue: F(10000),
    primeEncaissee: F(encaisse),
    primeAbandonnee: false,
    duInitial: du,
    exigible: du,
    aRegulariser: Z,
    restePayable: max0(payable - paye),
    resteDu: max0(du - paye),
    avance: max0(paye - payable),
    ...p,
    du,
    paye,
    payable,
  };
}
const t6ter = () => Array.from({ length: 12 }, (_, i) => ligne(i + 1, i < 3 ? 10000 : 0));
const parts = (r: ReturnType<typeof planifierReglementCpt>) => (r.ok ? r.parts.map((p) => [p.rang, Number(p.montant) / 100]) : r.message);
const sans = { accepterAvance: false, modeDerogation: null };

describe("GC-9e — affectation aux montants exigibles les plus anciens", () => {
  it("T6 ter : 3 000 affectés aux trois premières échéances, sans avance", () => {
    const r = planifierReglementCpt(t6ter(), F(3000), sans);
    expect(parts(r)).toEqual([
      [1, 1000],
      [2, 1000],
      [3, 1000],
    ]);
    expect(r.ok && r.montantAvance).toBe(Z);
  });

  it("règlement partiel : la plus ancienne d'abord", () => {
    expect(parts(planifierReglementCpt(t6ter().reverse(), F(1500), sans))).toEqual([
      [1, 1000],
      [2, 500],
    ]);
  });

  it("au-delà du payable sans demande d'avance : refusé, avec le payable et le reste dû", () => {
    const r = planifierReglementCpt(t6ter(), F(3001), sans);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/payable aujourd'hui \(3\s000 FCFA\).*avance.*12\s000 FCFA/);
  });

  it("avance demandée : le surplus va au reste dû le plus ancien et il est compté comme avance", () => {
    const r = planifierReglementCpt(t6ter(), F(4500), { accepterAvance: true, modeDerogation: null });
    expect(parts(r)).toEqual([
      [1, 1000],
      [2, 1000],
      [3, 1000],
      [4, 1000],
      [5, 500],
    ]);
    expect(r.ok && r.montantAvance).toBe(F(1500));
  });

  it("au-delà du reste dû : jamais, même avec avance", () => {
    const r = planifierReglementCpt(t6ter(), F(12001), { accepterAvance: true, modeDerogation: null });
    expect(!r.ok && r.message).toMatch(/dépasse le reste dû/);
  });

  it("règlement décidé « en une fois » : tout l'exigible est payable, sans avance", () => {
    const r = planifierReglementCpt(t6ter(), F(12000), { accepterAvance: false, modeDerogation: "EN_UNE_FOIS" });
    expect(r.ok && r.montantAvance).toBe(Z);
    expect(r.ok && r.parts).toHaveLength(12);
  });

  it("règlement décidé « au prorata » sur des lignes « en une fois » : plafonné à la part encaissée", () => {
    const lignes = t6ter().map((l) => ({ ...l, mode: "EN_UNE_FOIS" as const, payable: l.du, restePayable: l.du }));
    expect(capaciteReglementCpt(lignes, null).payable).toBe(F(12000));
    expect(capaciteReglementCpt(lignes, "AU_PRORATA").payable).toBe(F(3000));
  });

  it("une avance de la même nature réduit le net payable (jamais versé deux fois)", () => {
    // La ligne 12 a été payée d'avance : 1 000 déjà versés sans prime encaissée.
    const lignes = t6ter().map((l) => (l.rang === 12 ? ligne(12, 0, { paye: F(1000) }) : l));
    expect(capaciteReglementCpt(lignes, null)).toEqual({ payable: F(2000), plafond: F(11000) });
    expect(planifierReglementCpt(lignes, F(2001), sans).ok).toBe(false);
    expect(parts(planifierReglementCpt(lignes, F(2000), sans))).toEqual([
      [1, 1000],
      [2, 1000],
    ]);
  });

  it("deux natures dans un même règlement : impossible", () => {
    expect(() => planifierReglementCpt([ligne(1, 10000), ligne(2, 10000, { nature: "HONORAIRES" })], F(1), sans)).toThrow();
  });
});

describe("GC-9e — « payé en une fois » d'une ligne", () => {
  const a = (montant: number, derogation: "EN_UNE_FOIS" | null, creeAt: string) => ({ montant: F(montant), derogation, creeAt });
  it("tout ce qui est payé jusqu'au dernier règlement « en une fois » compte, les règlements suivants non", () => {
    expect(payeDecideEnUneFoisCpt([a(300, null, "1"), a(500, "EN_UNE_FOIS", "2"), a(100, null, "3")])).toBe(F(800));
    expect(payeDecideEnUneFoisCpt([a(100, null, "3"), a(500, "EN_UNE_FOIS", "2")])).toBe(F(500));
    expect(payeDecideEnUneFoisCpt([a(300, null, "1")])).toBe(Z);
  });
});

describe("GC-9e — saisie d'un règlement", () => {
  const base = { partenaireId: "p", nature: "COMMISSION", montant: "3 000", date: "2026-11-26", mode: "VIREMENT", referenceReglement: "VIR-1" };
  const erreurs = (s: Record<string, unknown>) => {
    const r = validerSaisieReglementCpt(s, "2026-11-26");
    return r.ok ? {} : r.erreurs;
  };

  it("saisie valable, montant lu en centimes", () => {
    const r = validerSaisieReglementCpt(base, "2026-11-26");
    expect(r.ok && r.valeur.montant).toBe(F(3000));
  });

  it("nature obligatoire, montant > 0 sans décimales, date jamais future, référence et moyen obligatoires", () => {
    expect(erreurs({ ...base, nature: "" }).nature).toBeDefined();
    expect(erreurs({ ...base, montant: "0" }).montant).toBeDefined();
    expect(erreurs({ ...base, montant: "1500,5" }).montant).toBeDefined();
    expect(erreurs({ ...base, montant: "-100" }).montant).toBeDefined();
    expect(erreurs({ ...base, date: "2026-11-27" }).date).toMatch(/futur/);
    expect(erreurs({ ...base, referenceReglement: " " }).referenceReglement).toBeDefined();
    expect(erreurs({ ...base, mode: "TROC" }).mode).toBeDefined();
  });

  it("un choix de mode sur le règlement exige un motif d'au moins 10 caractères", () => {
    expect(erreurs({ ...base, modeDerogation: "EN_UNE_FOIS" }).motif).toBeDefined();
    expect(erreurs({ ...base, modeDerogation: "EN_UNE_FOIS", motif: "trop bref" }).motif).toBeDefined();
    expect(erreurs({ ...base, modeDerogation: "EN_UNE_FOIS", motif: "Accord écrit du courtier" })).toEqual({});
  });
});

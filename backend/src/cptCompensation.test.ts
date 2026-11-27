import { describe, expect, it } from "vitest";

import { capaciteCompensationCpt, planifierCompensationCpt, validerSaisieCompensationCpt } from "./cptCompensation";
import { soldesParNatureCpt, type LigneRemunerationCalculeeCpt } from "./cptRemuneration";
import type { NatureRemunerationCpt } from "./cptReferentiels";

const F = (fcfa: number) => BigInt(fcfa) * BigInt(100);
const Z = BigInt(0);
const max0 = (x: bigint) => (x > Z ? x : Z);

function ligne(nature: NatureRemunerationCpt, rang: number, payable: number, paye: number, numPolice = "POL-1"): LigneRemunerationCalculeeCpt {
  const du = F(10000);
  return {
    cle: `${numPolice}|${nature}|${rang}`,
    ligneId: null,
    contratId: numPolice,
    numPolice,
    echeanceId: `${numPolice}-${rang}`,
    rang,
    datePrevue: `2026-0${rang}-01`,
    beneficiaireId: "cabinet",
    nature,
    conventionId: "cv",
    faitGenerateur: "EMISSION",
    mode: "AU_PRORATA",
    modeDecide: false,
    payeEnUneFois: Z,
    primeDue: du,
    primeEncaissee: Z,
    primeAbandonnee: false,
    duInitial: du,
    du,
    exigible: du,
    payable: F(payable),
    paye: F(paye),
    restePayable: max0(F(payable) - F(paye)),
    resteDu: max0(du - F(paye)),
    avance: max0(F(paye) - F(payable)),
    aRegulariser: Z,
  };
}
// Commission : 2 000 d'avance sur l'échéance 1 et 1 000 sur la 2. Honoraires : 5 000 puis 2 000 à verser.
const lignes = [ligne("COMMISSION", 1, 0, 2000), ligne("COMMISSION", 2, 0, 1000), ligne("HONORAIRES", 1, 5000, 0), ligne("HONORAIRES", 2, 2000, 0)];
const parts = (p: { rang: number; montant: bigint }[]) => p.map((x) => [x.rang, Number(x.montant) / 100]);

describe("GC-9f — compensation explicite entre deux natures", () => {
  it("aucune compensation automatique : les soldes restent séparés tant qu'on n'en demande pas", () => {
    const s = soldesParNatureCpt(lignes);
    expect(s.COMMISSION.avanceNette).toBe(F(3000));
    expect(s.HONORAIRES.montantReglable).toBe(F(7000));
  });

  it("capacité = la plus petite de l'avance de la source et du net à verser de la cible", () => {
    expect(capaciteCompensationCpt(lignes, "COMMISSION", "HONORAIRES")).toEqual({ avanceSource: F(3000), aVerserCible: F(7000), disponible: F(3000) });
    expect(capaciteCompensationCpt(lignes, "HONORAIRES", "COMMISSION").disponible).toBe(Z);
  });

  it("reprise des avances les plus anciennes, imputation sur les restes les plus anciens", () => {
    const r = planifierCompensationCpt(lignes, "COMMISSION", "HONORAIRES", F(2500));
    expect(r.ok && parts(r.reprises)).toEqual([
      [1, 2000],
      [2, 500],
    ]);
    expect(r.ok && parts(r.ajouts)).toEqual([[1, 2500]]);
  });

  it("jamais plus que l'avance de la source, ni plus que le net à verser de la cible", () => {
    const trop = planifierCompensationCpt(lignes, "COMMISSION", "HONORAIRES", F(3001));
    expect(!trop.ok && trop.message).toMatch(/avance disponible en commission \(3\s000 FCFA\)/);
    const cible = planifierCompensationCpt([ligne("COMMISSION", 1, 0, 3000), ligne("HONORAIRES", 1, 1000, 0)], "COMMISSION", "HONORAIRES", F(1001));
    expect(!cible.ok && cible.message).toMatch(/reste à verser en honoraires de gestion \(1\s000 FCFA\)/);
  });

  it("une avance déjà absorbée DANS sa nature n'est plus disponible", () => {
    const absorbee = [ligne("COMMISSION", 1, 0, 2000), ligne("COMMISSION", 2, 2000, 0), ligne("HONORAIRES", 1, 5000, 0)];
    expect(capaciteCompensationCpt(absorbee, "COMMISSION", "HONORAIRES").disponible).toBe(Z);
    expect(planifierCompensationCpt(absorbee, "COMMISSION", "HONORAIRES", F(1)).ok).toBe(false);
  });

  it("sans avance, rien à compenser ; même nature impossible", () => {
    expect(planifierCompensationCpt(lignes, "ACCESSOIRES", "HONORAIRES", F(1)).ok).toBe(false);
    expect(planifierCompensationCpt(lignes, "COMMISSION", "COMMISSION", F(1)).ok).toBe(false);
  });

  it("saisie : deux natures différentes, montant > 0, motif d'au moins 10 caractères", () => {
    const base = { partenaireId: "p", natureSource: "COMMISSION", natureCible: "HONORAIRES", montant: "1 000", motif: "Compensation convenue" };
    const erreurs = (s: Record<string, unknown>) => {
      const r = validerSaisieCompensationCpt(s);
      return r.ok ? {} : r.erreurs;
    };
    expect(erreurs(base)).toEqual({});
    expect(erreurs({ ...base, natureCible: "COMMISSION" }).natureCible).toBeDefined();
    expect(erreurs({ ...base, montant: "0" }).montant).toBeDefined();
    expect(erreurs({ ...base, motif: "trop bref" }).motif).toMatch(/10/);
  });
});

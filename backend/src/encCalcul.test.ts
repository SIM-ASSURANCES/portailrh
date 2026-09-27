import { Decimal as PrismaDecimal } from "@prisma/client/runtime/client";
import { describe, expect, it } from "vitest";

import {
  ajouterAuCumul,
  arrondirCentime,
  calculerDdf,
  calculerEffetAnnulation,
  calculerExigibilite,
  calculerExigibiliteSuspens,
  calculerVersement,
  contrepasser,
  cumulVide,
  decomposerDepuisPrimeNette,
  decomposerDepuisPrimeTtc,
  EncCalculError,
  jourCalendaire,
  montant,
  repartirEnEcheances,
  semaineIso,
  situationNature,
  statutContrat,
  statutPaiement,
  type DecimalLike,
  type MontantsContrat,
  type VersementCalcule,
} from "./encCalcul";

const PARAMS = { delaiMois: 1, jourLimite: 20 };
const f2 = (d: { toFixed(n: number): string }) => d.toFixed(2);
const iso = (d: Date) => d.toISOString().slice(0, 10);

function contrat(S: string, T: string, U: string, V: string, W: string, X: string): MontantsContrat {
  return { S: montant(S), T: montant(T), U: montant(U), V: montant(V), W: montant(W), X: montant(X) };
}

/** Contrat de test du cahier (§9) : police IRO-2026-000843-I00000. */
const CONTRAT_9 = () => contrat("1500", "1398.60", "0", "101.40", "251.75", "34.97");

function enchainer(c: MontantsContrat, montants: string[]): VersementCalcule[] {
  let cumul = cumulVide();
  return montants.map((z) => {
    const v = calculerVersement(c, cumul, z);
    cumul = ajouterAuCumul(cumul, v);
    return v;
  });
}

function attendreErreur(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(EncCalculError);
    expect((e as EncCalculError).code).toBe(code);
    return e as EncCalculError;
  }
  throw new Error(`Erreur ${code} attendue, aucune levée`);
}

describe("§9.1 — trois versements et reliquat", () => {
  const [v1, v2, v3] = enchainer(CONTRAT_9(), ["500", "700", "300"]);

  it("versement 1 (10/07/2026)", () => {
    expect([f2(v1.Z), f2(v1.AA), f2(v1.AB), f2(v1.AD), f2(v1.commission), f2(v1.honoraires)]).toEqual([
      "500.00", "1000.00", "466.20", "33.80", "83.92", "11.66",
    ]);
    expect(v1.estSoldant).toBe(false);
  });

  it("versement 2 (20/08/2026)", () => {
    expect([f2(v2.AA), f2(v2.AB), f2(v2.AD), f2(v2.commission), f2(v2.honoraires)]).toEqual([
      "300.00", "652.68", "47.32", "117.48", "16.32",
    ]);
  });

  it("versement 3 solde le contrat et reçoit les reliquats exacts", () => {
    expect(v3.estSoldant).toBe(true);
    expect([f2(v3.AA), f2(v3.AB), f2(v3.AD), f2(v3.commission), f2(v3.honoraires)]).toEqual([
      "0.00", "279.72", "20.28", "50.35", "6.99",
    ]);
  });

  it("les totaux égalent le contrat, sans écart d'arrondi", () => {
    const tot = (k: "Z" | "AB" | "AD" | "commission" | "honoraires") => f2([v1, v2, v3].reduce((a, v) => a.plus(v[k]), montant("0")));
    expect([tot("Z"), tot("AB"), tot("AD"), tot("commission"), tot("honoraires")]).toEqual([
      "1500.00", "1398.60", "101.40", "251.75", "34.97",
    ]);
  });

  it("mois d'exigibilité : août, septembre, octobre 2026", () => {
    const exig = ["2026-07-10", "2026-08-20", "2026-09-05"].map((d) => {
      const [a, m, j] = d.split("-").map((x) => parseInt(x, 10));
      return iso(calculerExigibilite(jourCalendaire(a, m, j), PARAMS).moisExigibilite);
    });
    expect(exig).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
  });
});

describe("§9.3 — commissions au 31/08/2026", () => {
  it("dû 201,40 ; payé 83,92 ; restant 117,48 ; non acquis 50,35", () => {
    const [v1, v2] = enchainer(CONTRAT_9(), ["500", "700"]);
    const s = situationNature("251.75", [v1.commission, v2.commission], "83.92");
    expect([f2(s.du), f2(s.paye), f2(s.restantAPayer), f2(s.nonAcquis), f2(s.aRecuperer)]).toEqual([
      "201.40", "83.92", "117.48", "50.35", "0.00",
    ]);
  });

  it("un paiement au-delà du dû crée un montant à récupérer", () => {
    const s = situationNature("251.75", [montant("83.92")], "100");
    expect([f2(s.restantAPayer), f2(s.aRecuperer)]).toEqual(["0.00", "16.08"]);
  });
});

describe("§9.4 — prime acquise selon le type d'annulation (après le versement 1)", () => {
  const base = { primeTtc: "1500", encaisse: "500", dateEffet: jourCalendaire(2026, 7, 1), dateEcheance: jourCalendaire(2026, 8, 1) };

  it("sans effet au 15/07/2026 : prime acquise 0, remboursement 500", () => {
    const e = calculerEffetAnnulation("SANS_EFFET", { ...base, dateAnnulation: jourCalendaire(2026, 7, 15) });
    expect([f2(e.primeAcquise), f2(e.remboursement), f2(e.restantDu)]).toEqual(["0.00", "500.00", "0.00"]);
  });

  it("résiliation au 16/07/2026 : 1 500 × 15 ÷ 31 = 725,81 ; restant dû ramené à 225,81", () => {
    const e = calculerEffetAnnulation("RESILIATION", { ...base, dateAnnulation: jourCalendaire(2026, 7, 16) });
    expect([f2(e.primeAcquise), f2(e.remboursement), f2(e.restantDu)]).toEqual(["725.81", "0.00", "225.81"]);
  });

  it("non-paiement : prime acquise = encaissé, aucun remboursement, part non encaissée abandonnée", () => {
    const e = calculerEffetAnnulation("NON_PAIEMENT", { ...base, dateAnnulation: jourCalendaire(2026, 7, 20) });
    expect([f2(e.primeAcquise), f2(e.remboursement), f2(e.restantDu)]).toEqual(["500.00", "0.00", "0.00"]);
  });

});

describe("Limites — résiliation hors cahier : contrat ENTIÈREMENT payé (1 500 encaissés)", () => {
  it("encaissé 1 500 > prime acquise 725,81 : ristourne 1 500 − 725,81 = 774,19, restant dû 0", () => {
    const e = calculerEffetAnnulation("RESILIATION", {
      primeTtc: "1500",
      encaisse: "1500",
      dateEffet: jourCalendaire(2026, 7, 1),
      dateEcheance: jourCalendaire(2026, 8, 1),
      dateAnnulation: jourCalendaire(2026, 7, 16),
    });
    expect([f2(e.primeAcquise), f2(e.remboursement), f2(e.restantDu)]).toEqual(["725.81", "774.19", "0.00"]);
  });
});

describe("§9.7 — un chèque de 250 000 pour trois polices (taxe 7,25 %)", () => {
  const taux = { tauxTaxe: "0.0725", tauxCommission: "0.18", tauxGestion: "0.025" };
  const attendu = [
    ["100000.00", "93240.09", "6759.91"],
    ["90000.00", "83916.08", "6083.92"],
    ["60000.00", "55944.06", "4055.94"],
  ];

  it("chaque police soldée par son versement (reliquat = montants du contrat)", () => {
    const lignes = attendu.map(([z]) => calculerVersement(decomposerDepuisPrimeTtc(z, taux), cumulVide(), z));
    expect(lignes.map((v) => [f2(v.Z), f2(v.AB), f2(v.AD)])).toEqual(attendu);
    expect(f2(lignes.reduce((a, v) => a.plus(v.AB), montant("0")))).toBe("233100.23");
    expect(f2(lignes.reduce((a, v) => a.plus(v.AD), montant("0")))).toBe("16899.77");
  });

  it("chaque police en paiement partiel d'un contrat de 1 000 000 (prorata non soldant)", () => {
    const c = decomposerDepuisPrimeTtc("1000000", taux);
    const lignes = attendu.map(([z]) => calculerVersement(c, cumulVide(), z));
    expect(lignes.map((v) => [f2(v.Z), f2(v.AB), f2(v.AD)])).toEqual(attendu);
  });

  it("taxe exigible en octobre 2026, à reverser avant le 20/10/2026", () => {
    const e = calculerExigibilite(jourCalendaire(2026, 9, 15), PARAMS);
    expect([iso(e.moisExigibilite), iso(e.dateLimite)]).toEqual(["2026-10-01", "2026-10-20"]);
  });
});

describe("§9.8 — saisie directe et calcul inverse", () => {
  const taux = { tauxAccessoires: "0.05", tauxTaxe: "0.0725", tauxCommission: "0.18", tauxGestion: "0.025" };

  it("depuis la prime nette 100 000 : accessoires 5 000 ; taxe 7 612,50 ; TTC 112 612,50 ; commission 18 000 ; gestion 2 500", () => {
    const c = decomposerDepuisPrimeNette("100000", taux);
    expect([f2(c.T), f2(c.U), f2(c.V), f2(c.S), f2(c.W), f2(c.X)]).toEqual([
      "100000.00", "5000.00", "7612.50", "112612.50", "18000.00", "2500.00",
    ]);
  });

  it("depuis la prime TTC 112 612,50 : l'application retrouve une prime nette de 100 000", () => {
    const c = decomposerDepuisPrimeTtc("112612.50", taux);
    expect([f2(c.T), f2(c.U), f2(c.V), f2(c.S), f2(c.W), f2(c.X)]).toEqual([
      "100000.00", "5000.00", "7612.50", "112612.50", "18000.00", "2500.00",
    ]);
  });
});

describe("§9.9 — paiement non identifié en septembre, identifié en novembre", () => {
  const taux = { tauxTaxe: "0.0725", tauxCommission: "0.18", tauxGestion: "0.025" };

  it("police A, Z = 200 000 : AB = 186 480,19 ; AD = 13 519,81", () => {
    const soldant = calculerVersement(decomposerDepuisPrimeTtc("200000", taux), cumulVide(), "200000");
    const partiel = calculerVersement(decomposerDepuisPrimeTtc("1000000", taux), cumulVide(), "200000");
    for (const v of [soldant, partiel]) expect([f2(v.AB), f2(v.AD)]).toEqual(["186480.19", "13519.81"]);
  });

  it("identifié le 10/11/2026 : taxe portée sur la déclaration à reverser avant le 20/11/2026", () => {
    const e = calculerExigibiliteSuspens(jourCalendaire(2026, 11, 10), PARAMS);
    expect([iso(e.moisExigibilite), iso(e.dateLimite)]).toEqual(["2026-11-01", "2026-11-20"]);
  });
});

describe("Limites — versements", () => {
  it("contrat soldé en un seul versement : toutes les composantes du contrat", () => {
    const v = calculerVersement(CONTRAT_9(), cumulVide(), "1500");
    expect(v.estSoldant).toBe(true);
    expect([f2(v.AA), f2(v.AB), f2(v.AC), f2(v.AD), f2(v.commission), f2(v.honoraires)]).toEqual([
      "0.00", "1398.60", "0.00", "101.40", "251.75", "34.97",
    ]);
  });

  it("contre-passation = copie négative exacte des valeurs figées", () => {
    const [v1] = enchainer(CONTRAT_9(), ["500"]);
    const cp = contrepasser(v1, v1.AA);
    for (const k of ["Z", "AB", "AC", "AD", "commission", "honoraires"] as const) {
      expect(cp[k].eq(v1[k].negated())).toBe(true);
      expect(cp[k].plus(v1[k]).isZero()).toBe(true);
    }
    expect([f2(cp.Z), f2(cp.AB), f2(cp.AD), f2(cp.commission), f2(cp.AA)]).toEqual([
      "-500.00", "-466.20", "-33.80", "-83.92", "1500.00",
    ]);
  });

  it("trop-perçu refusé ; montant nul ou négatif refusé", () => {
    attendreErreur(() => calculerVersement(CONTRAT_9(), cumulVide(), "1500.01"), "TROP_PERCU");
    const [v1] = enchainer(CONTRAT_9(), ["1000"]);
    attendreErreur(() => calculerVersement(CONTRAT_9(), ajouterAuCumul(cumulVide(), v1), "600"), "TROP_PERCU");
    attendreErreur(() => calculerVersement(CONTRAT_9(), cumulVide(), "0"), "MONTANT_INVALIDE");
    attendreErreur(() => calculerVersement(CONTRAT_9(), cumulVide(), "-10"), "MONTANT_INVALIDE");
  });

  it("contrat incohérent (T + U + V ≠ S) : choix PROVISOIRE ΣAD = V au versement soldant (ambiguïté 18)", () => {
    const c = contrat("1000", "900", "0", "150", "0", "0");
    const [v1, v2] = enchainer(c, ["500", "500"]);
    expect([f2(v1.AB), f2(v1.AD)]).toEqual(["450.00", "50.00"]);
    expect([f2(v2.AB), f2(v2.AD)]).toEqual(["450.00", "100.00"]);
    expect(f2(v2.AB.plus(v2.AC).plus(v2.AD))).toBe("550.00"); // ≠ Z = 500 : à trancher par le client
  });
});

describe("Limites — arrondi", () => {
  it("pile à 0,005 : arrondi au centime supérieur (half-up), là où un flottant se trompe", () => {
    expect(f2(arrondirCentime("1.005"))).toBe("1.01");
    expect(f2(arrondirCentime("2.675"))).toBe("2.68");
    expect(f2(arrondirCentime("-1.005"))).toBe("-1.01");
    expect(Math.round(1.005 * 100) / 100).toBe(1); // le piège évité par le calcul décimal
  });

  it("prorata pile à 0,005 sur AB, commission et honoraires", () => {
    const c = contrat("1000", "900.01", "0", "99.99", "180.01", "25.01");
    const v = calculerVersement(c, cumulVide(), "500");
    expect([f2(v.AB), f2(v.AD), f2(v.commission), f2(v.honoraires)]).toEqual(["450.01", "49.99", "90.01", "12.51"]);
  });

  it("interopérable avec Prisma.Decimal en entrée et en sortie ; un nombre flottant est refusé", () => {
    const c = contrat("1500", "1398.60", "0", "101.40", "251.75", "34.97");
    const viaPrisma = calculerVersement(
      { ...c, T: montant(new PrismaDecimal("1398.60")), S: montant(new PrismaDecimal("1500")) },
      cumulVide(),
      new PrismaDecimal("500")
    );
    expect(f2(viaPrisma.AB)).toBe("466.20");
    const sortie: DecimalLike = viaPrisma.AB;
    expect(new PrismaDecimal(sortie.toFixed()).toFixed(2)).toBe("466.20");
    attendreErreur(() => montant(1500 as never), "MONTANT_INVALIDE");
  });
});

describe("Limites — calcul inverse", () => {
  const taux = { tauxAccessoires: "0.05", tauxTaxe: "0.0725", tauxCommission: "0.18", tauxGestion: "0.025" };

  it("refusé si une base n'est pas celle par défaut", () => {
    const e = attendreErreur(() => decomposerDepuisPrimeTtc("112612.50", { ...taux, baseTaxe: "PRIME_NETTE" }), "CALCUL_INVERSE_IMPOSSIBLE");
    expect(e.message).toContain("taxe");
    attendreErreur(() => decomposerDepuisPrimeTtc("112612.50", { ...taux, baseCommission: "PRIME_TTC" }), "CALCUL_INVERSE_IMPOSSIBLE");
  });

  it("refusé si les accessoires sont en montant fixe", () => {
    const { tauxAccessoires: _omis, ...sansTaux } = taux;
    void _omis;
    const e = attendreErreur(() => decomposerDepuisPrimeTtc("112612.50", { ...sansTaux, montantFixeAccessoires: "5000" }), "CALCUL_INVERSE_IMPOSSIBLE");
    expect(e.message).toContain("montant fixe");
  });

  it("saisie directe : base « prime TTC » refusée pour la taxe (circulaire), acceptée pour la commission", () => {
    attendreErreur(() => decomposerDepuisPrimeNette("100000", { ...taux, baseTaxe: "PRIME_TTC" }), "BASE_CIRCULAIRE");
    const c = decomposerDepuisPrimeNette("100000", { ...taux, baseCommission: "PRIME_TTC" });
    expect(f2(c.W)).toBe("20270.25"); // 112 612,50 × 18 %
  });
});

describe("Limites — exigibilité", () => {
  it("encaissement de décembre → exigible en janvier N+1, limite 20/01", () => {
    const e = calculerExigibilite(jourCalendaire(2026, 12, 31), PARAMS);
    expect([iso(e.moisEncaissement), iso(e.moisExigibilite), iso(e.dateLimite)]).toEqual(["2026-12-01", "2027-01-01", "2027-01-20"]);
  });

  it("paramètres en arguments : délai de 2 mois, jour limite ramené à la fin de février", () => {
    const e = calculerExigibilite(jourCalendaire(2026, 12, 5), { delaiMois: 2, jourLimite: 31 });
    expect([iso(e.moisExigibilite), iso(e.dateLimite)]).toEqual(["2027-02-01", "2027-02-28"]);
    attendreErreur(() => calculerExigibilite(jourCalendaire(2026, 12, 5), { delaiMois: 1, jourLimite: 0 }), "PARAMETRE_INVALIDE");
  });

  it("suspens identifié le 25/11 → décembre, limite 20/12", () => {
    const e = calculerExigibiliteSuspens(jourCalendaire(2026, 11, 25), PARAMS);
    expect([iso(e.moisExigibilite), iso(e.dateLimite)]).toEqual(["2026-12-01", "2026-12-20"]);
  });

  it("suspens identifié PILE le 20/11 : choix PROVISOIRE « déclaration suivante » (décembre) — ambiguïté 22", () => {
    const e = calculerExigibiliteSuspens(jourCalendaire(2026, 11, 20), PARAMS);
    expect([iso(e.moisExigibilite), iso(e.dateLimite)]).toEqual(["2026-12-01", "2026-12-20"]);
  });

  it("suspens identifié le 25/12 → janvier N+1", () => {
    const e = calculerExigibiliteSuspens(jourCalendaire(2026, 12, 25), PARAMS);
    expect(iso(e.dateLimite)).toBe("2027-01-20");
  });
});

describe("Limites — semaine ISO (colonne AG)", () => {
  it("31/12/2026 et 01/01/2027 → « Sem 53 - 2026 » (année ISO, pas civile)", () => {
    expect(semaineIso(jourCalendaire(2026, 12, 31)).libelle).toBe("Sem 53 - 2026");
    expect(semaineIso(jourCalendaire(2027, 1, 1)).libelle).toBe("Sem 53 - 2026");
  });

  it("changements d'année ISO dans l'autre sens et semaine courante", () => {
    expect(semaineIso(jourCalendaire(2027, 1, 4)).libelle).toBe("Sem 1 - 2027");
    expect(semaineIso(jourCalendaire(2025, 12, 29)).libelle).toBe("Sem 1 - 2026");
    expect(semaineIso(jourCalendaire(2026, 7, 10)).libelle).toBe("Sem 28 - 2026");
  });
});

describe("Limites — échéancier (F8)", () => {
  it("somme = prime TTC, reliquat sur la dernière, 31/01 → 28/02 → 31/03", () => {
    const e = repartirEnEcheances("1000", 3, jourCalendaire(2027, 1, 31));
    expect(e.map((x) => [x.numero, iso(x.date), f2(x.montant)])).toEqual([
      [1, "2027-01-31", "333.33"],
      [2, "2027-02-28", "333.33"],
      [3, "2027-03-31", "333.34"],
    ]);
    expect(f2(e.reduce((a, x) => a.plus(x.montant), montant("0")))).toBe("1000.00");
  });

  it("année bissextile : 31/01/2028 → 29/02/2028 ; changement d'année", () => {
    expect(repartirEnEcheances("1500", 2, jourCalendaire(2028, 1, 31)).map((x) => iso(x.date))).toEqual(["2028-01-31", "2028-02-29"]);
    expect(repartirEnEcheances("1500", 3, jourCalendaire(2026, 11, 30)).map((x) => iso(x.date))).toEqual([
      "2026-11-30", "2026-12-30", "2027-01-30",
    ]);
  });

  it("la dernière échéance n'est jamais négative ; nombre invalide refusé", () => {
    const e = repartirEnEcheances("0.05", 10, jourCalendaire(2026, 1, 1));
    expect(e.every((x) => x.montant.gte(0))).toBe(true);
    expect(f2(e.reduce((a, x) => a.plus(x.montant), montant("0")))).toBe("0.05");
    attendreErreur(() => repartirEnEcheances("1000", 0, jourCalendaire(2026, 1, 1)), "PARAMETRE_INVALIDE");
  });
});

describe("DDF et statuts (§5.3, §5.6)", () => {
  it("DDF = 31 jours pour le contrat du cahier ; échéance antérieure refusée", () => {
    expect(calculerDdf(jourCalendaire(2026, 7, 1), jourCalendaire(2026, 8, 1))).toBe(31);
    attendreErreur(() => calculerDdf(jourCalendaire(2026, 8, 1), jourCalendaire(2026, 7, 1)), "DATES_INVALIDES");
  });

  it("statut du contrat", () => {
    const effet = jourCalendaire(2026, 7, 1);
    const ech = jourCalendaire(2026, 8, 1);
    expect(statutContrat(jourCalendaire(2026, 6, 30), effet, ech, false)).toBe("A_VENIR");
    expect(statutContrat(jourCalendaire(2026, 8, 1), effet, ech, false)).toBe("EN_COURS");
    expect(statutContrat(jourCalendaire(2026, 8, 2), effet, ech, false)).toBe("EXPIRE");
    expect(statutContrat(jourCalendaire(2026, 7, 15), effet, ech, true)).toBe("ANNULE");
  });

  it("statut du paiement", () => {
    expect(statutPaiement("0", "1500", false)).toBe("NON_PAYE");
    expect(statutPaiement("500", "1500", false)).toBe("PARTIELLEMENT_PAYE");
    expect(statutPaiement("1500", "1500", false)).toBe("TOTALEMENT_PAYE");
    expect(statutPaiement("1600", "1500", false)).toBe("TROP_PERCU");
    expect(statutPaiement("500", "1500", true)).toBe("ANNULE");
  });
});

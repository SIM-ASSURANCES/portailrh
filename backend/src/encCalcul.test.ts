import { Decimal as PrismaDecimal } from "@prisma/client/runtime/client";
import { describe, expect, it } from "vitest";

import {
  ajouterAuCumul,
  arrondirCentime,
  calculerDdf,
  calculerEffetAnnulation,
  calculerExigibilite,
  calculerExigibiliteReprise,
  calculerVersement,
  choisirTauxAccessoires,
  contrepasser,
  cumulVide,
  EncCalculError,
  figerEncaissement,
  jourCalendaire,
  montant,
  naturesARegulariser,
  partagerAccessoires,
  recalculerPartAccessoires,
  semaineIso,
  situationNature,
  statutContrat,
  statutPaiement,
  type DecimalLike,
  type EncaissementFige,
  type MontantsContrat,
  type VersementCalcule,
} from "./encCalcul";

// Recette : cahier des charges V2.6, section 9 (résultats attendus au centime, sur les valeurs stockées — D3).

const PARAMS = { jourLimite: 20 };
const f2 = (d: { toFixed(n: number): string }) => d.toFixed(2);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const jour = (s: string) => {
  const [j, m, a] = s.split("/").map((x) => parseInt(x, 10));
  return jourCalendaire(a, m, j);
};

function contrat(S: string, T: string, U: string, V: string, W: string, X: string): MontantsContrat {
  return { S: montant(S), T: montant(T), U: montant(U), V: montant(V), W: montant(W), X: montant(X) };
}

/** Contrat IRO-2026-000843-I00000 (recette 9.1, 9.9, 9.13). */
const CONTRAT_9_1 = () => contrat("1500", "1398.60", "0", "101.40", "251.75", "34.97");

/**
 * Contrat « taxe 7,25 % de la prime nette, sans accessoires » (9.4, 9.5), dont le cahier ne donne pas la prime :
 * T = S ÷ 1,0725 arrondi au centime, V = S − T (commission et honoraires hors sujet).
 */
function contratTaxe725(S: string): MontantsContrat {
  const s = montant(S);
  const T = arrondirCentime(s.dividedBy("1.0725"));
  return { S: s, T, U: montant("0"), V: s.minus(T), W: montant("0"), X: montant("0") };
}

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

describe("9.1 — prorata sur trois encaissements", () => {
  const [v1, v2, v3] = enchainer(CONTRAT_9_1(), ["500", "700", "300"]);

  it("encaissement 1 (10/07/2026)", () => {
    expect([f2(v1.Z), f2(v1.AA), f2(v1.AB), f2(v1.AD), f2(v1.commission), f2(v1.honoraires)]).toEqual([
      "500.00", "1000.00", "466.20", "33.80", "83.92", "11.66",
    ]);
    expect(v1.estSoldant).toBe(false);
    expect(v1.tropPercu).toBeNull();
  });

  it("encaissement 2 (20/08/2026)", () => {
    expect([f2(v2.AA), f2(v2.AB), f2(v2.AD), f2(v2.commission), f2(v2.honoraires)]).toEqual([
      "300.00", "652.68", "47.32", "117.48", "16.32",
    ]);
  });

  it("encaissement 3 (05/09/2026) solde le contrat et reçoit les reliquats exacts", () => {
    expect(v3.estSoldant).toBe(true);
    expect([f2(v3.AA), f2(v3.AB), f2(v3.AD), f2(v3.commission), f2(v3.honoraires)]).toEqual([
      "0.00", "279.72", "20.28", "50.35", "6.99",
    ]);
  });

  it("totaux égaux aux montants du fichier", () => {
    const tot = (k: "Z" | "AB" | "AD" | "commission" | "honoraires") => f2([v1, v2, v3].reduce((a, v) => a.plus(v[k]), montant("0")));
    expect([tot("Z"), tot("AB"), tot("AD"), tot("commission"), tot("honoraires")]).toEqual([
      "1500.00", "1398.60", "101.40", "251.75", "34.97",
    ]);
  });

  it("saisis le jour même : taxe exigible en août, septembre, octobre 2026, sans régularisation", () => {
    const e = ["10/07/2026", "20/08/2026", "05/09/2026"].map((d) => calculerExigibilite(jour(d), jour(d), PARAMS));
    expect(e.map((x) => iso(x.moisExigibilite))).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
    expect(e.every((x) => !x.estRegularisation)).toBe(true);
  });
});

describe("9.4 — un chèque de 250 000 pour trois polices (taxe 7,25 % de la prime nette)", () => {
  const attendu = [
    ["100000.00", "93240.09", "6759.91"],
    ["90000.00", "83916.08", "6083.92"],
    ["60000.00", "55944.06", "4055.94"],
  ];

  it("chaque police soldée par son encaissement", () => {
    const lignes = attendu.map(([z]) => calculerVersement(contratTaxe725(z), cumulVide(), z));
    expect(lignes.map((v) => [f2(v.Z), f2(v.AB), f2(v.AD)])).toEqual(attendu);
    expect(f2(lignes.reduce((a, v) => a.plus(v.AB), montant("0")))).toBe("233100.23");
    expect(f2(lignes.reduce((a, v) => a.plus(v.AD), montant("0")))).toBe("16899.77");
  });

  it("mêmes montants en paiement partiel d'un contrat de 1 000 000 (prorata non soldant)", () => {
    const c = contratTaxe725("1000000");
    expect(attendu.map(([z]) => calculerVersement(c, cumulVide(), z)).map((v) => [f2(v.Z), f2(v.AB), f2(v.AD)])).toEqual(attendu);
  });

  it("reçu le 15/09/2026 et saisi le jour même : exigible en octobre 2026, avant le 20/10/2026", () => {
    const e = calculerExigibilite(jour("15/09/2026"), jour("15/09/2026"), PARAMS);
    expect([iso(e.moisExigibilite), iso(e.dateLimite), e.estRegularisation]).toEqual(["2026-10-01", "2026-10-20", false]);
  });
});

describe("9.5 — argent non identifié reçu en septembre, affecté en novembre", () => {
  it("police A, Z = 200 000 : AB = 186 480,19 ; AD = 13 519,81", () => {
    const soldant = calculerVersement(contratTaxe725("200000"), cumulVide(), "200000");
    const partiel = calculerVersement(contratTaxe725("1000000"), cumulVide(), "200000");
    for (const v of [soldant, partiel]) expect([f2(v.AB), f2(v.AD)]).toEqual(["186480.19", "13519.81"]);
  });

  it("daté du 12/09, pris en compte le 10/11 : exigible en novembre 2026, avant le 20/11/2026, « Régularisation »", () => {
    const e = calculerExigibilite(jour("12/09/2026"), jour("10/11/2026"), PARAMS);
    expect([iso(e.moisPaiement), iso(e.moisExigibilite), iso(e.dateLimite), e.estRegularisation]).toEqual([
      "2026-09-01", "2026-11-01", "2026-11-20", true,
    ]);
  });
});

describe("9.6 — partage des accessoires (WIASSUR 40 % / 60 %, P2 à 70 % / 30 %)", () => {
  // Prime TTC 1 600 dont 100 d'accessoires ; T et V ne sont pas donnés par le cahier (V2-A7) : 1 400 et 100.
  const c = contrat("1600", "1400", "100", "100", "0", "0");
  const tauxP1 = choisirTauxAccessoires({ police: null, partenaire: "0.40", defaut: "0" });
  const tauxP2 = choisirTauxAccessoires({ police: "0.70", partenaire: "0.40", defaut: "0" });
  const e1 = figerEncaissement({ contrat: c, cumul: cumulVide(), montantRecu: "800", tauxAccessoires: tauxP1.taux, exigibilite: calculerExigibilite(jour("10/09/2026"), jour("10/09/2026"), PARAMS) });
  const e2 = figerEncaissement({ contrat: c, cumul: cumulVide(), montantRecu: "800", tauxAccessoires: tauxP2.taux, exigibilite: calculerExigibilite(jour("10/09/2026"), jour("10/09/2026"), PARAMS) });

  it("taux retenu : P1 celui du partenaire, P2 celui de la police", () => {
    expect([f2(tauxP1.taux), tauxP1.source, f2(tauxP2.taux), tauxP2.source]).toEqual(["0.40", "PARTENAIRE", "0.70", "POLICE"]);
    expect(choisirTauxAccessoires({ defaut: "0" }).source).toBe("DEFAUT");
  });

  it("AC = 50 sur chaque police ; P1 : 20 / 30 ; P2 : 35 / 15 ; dû à WIASSUR : 55", () => {
    expect([f2(e1.AC), f2(e1.accessoires.partPartenaire), f2(e1.accessoires.partSim)]).toEqual(["50.00", "20.00", "30.00"]);
    expect([f2(e2.AC), f2(e2.accessoires.partPartenaire), f2(e2.accessoires.partSim)]).toEqual(["50.00", "35.00", "15.00"]);
    expect(f2(e1.accessoires.partPartenaire.plus(e2.accessoires.partPartenaire))).toBe("55.00");
  });

  it("WIASSUR passe à 50 %, appliqué aux parts non payées : P1 → 25 / 25 ; P2 reste 35 / 15 (taux de la police)", () => {
    const nouveauP1 = choisirTauxAccessoires({ police: null, partenaire: "0.50", defaut: "0" });
    const nouveauP2 = choisirTauxAccessoires({ police: "0.70", partenaire: "0.50", defaut: "0" });
    const p1 = recalculerPartAccessoires(e1.accessoires, e1.AC, false, nouveauP1.taux);
    const p2 = recalculerPartAccessoires(e2.accessoires, e2.AC, false, nouveauP2.taux);
    expect([f2(p1.partPartenaire), f2(p1.partSim), f2(p2.partPartenaire), f2(p2.partSim)]).toEqual(["25.00", "25.00", "35.00", "15.00"]);
  });

  it("une part déjà payée n'est jamais modifiée", () => {
    const p1 = recalculerPartAccessoires(e1.accessoires, e1.AC, true, "0.50");
    expect([f2(p1.partPartenaire), f2(p1.partSim)]).toEqual(["20.00", "30.00"]);
  });

  it("arrondi : part partenaire au centime (half-up), part SIM = AC − part partenaire ; taux hors [0 ; 1] refusé", () => {
    const p = partagerAccessoires("33.33", "0.50");
    expect([f2(p.partPartenaire), f2(p.partSim)]).toEqual(["16.67", "16.66"]);
    attendreErreur(() => partagerAccessoires("50", "1.2"), "TAUX_INVALIDE");
    attendreErreur(() => choisirTauxAccessoires({ police: "-0.1", defaut: "0" }), "TAUX_INVALIDE");
  });
});

describe("9.8 — contrat mensuel de 12 000 soldé en une fois", () => {
  const c = contrat("12000", "11188.81", "0", "811.19", "0", "0");
  const v = enchainer(c, ["1000", "1000", "1000", "9000"]);

  it("taxe de 67,60 sur chacune des trois mensualités, reliquat de 608,39 sur le quatrième ; reste dû 0 ; total 811,19", () => {
    expect(v.map((x) => f2(x.AD))).toEqual(["67.60", "67.60", "67.60", "608.39"]);
    expect([v[3].estSoldant, f2(v[3].AA)]).toEqual([true, "0.00"]);
    expect(f2(v.reduce((a, x) => a.plus(x.AD), montant("0")))).toBe("811.19");
  });

  it("exigible en août, septembre, octobre, octobre (saisis le jour même)", () => {
    const e = ["05/07/2026", "05/08/2026", "05/09/2026", "20/09/2026"].map((d) => calculerExigibilite(jour(d), jour(d), PARAMS));
    expect(e.map((x) => iso(x.moisExigibilite))).toEqual(["2026-08-01", "2026-09-01", "2026-10-01", "2026-10-01"]);
  });
});

describe("9.9 — contre-passation d'un encaissement de 500 (chèque impayé)", () => {
  const exig = calculerExigibilite(jour("10/09/2026"), jour("10/09/2026"), PARAMS);
  const origine: EncaissementFige = figerEncaissement({ contrat: CONTRAT_9_1(), cumul: cumulVide(), montantRecu: "500", tauxAccessoires: "0.40", exigibilite: exig });
  const cp = contrepasser(origine, origine.AA);

  it("copie négative exacte des montants figés, parts d'accessoires comprises", () => {
    for (const k of ["Z", "AB", "AC", "AD", "commission", "honoraires"] as const) expect(cp[k].plus(origine[k]).isZero()).toBe(true);
    expect(cp.accessoires.partPartenaire.plus(origine.accessoires.partPartenaire).isZero()).toBe(true);
    expect(cp.accessoires.partSim.plus(origine.accessoires.partSim).isZero()).toBe(true);
    expect([f2(cp.Z), f2(cp.AB), f2(cp.AD), f2(cp.commission), f2(cp.honoraires)]).toEqual(["-500.00", "-466.20", "-33.80", "-83.92", "-11.66"]);
  });

  it("reste dû de la police augmenté de 500 (1 000 → 1 500)", () => {
    expect([f2(origine.AA), f2(cp.AA)]).toEqual(["1000.00", "1500.00"]);
  });

  it("garde le mois d'exigibilité de l'origine (octobre 2026)", () => {
    expect([iso(cp.exigibilite.moisExigibilite), iso(cp.exigibilite.dateLimite)]).toEqual(["2026-10-01", "2026-10-20"]);
  });

  it("taxe marquée payée sur l'origine → signalée « à régulariser »", () => {
    expect(naturesARegulariser({ TAXE: true, COMMISSION: false })).toEqual(["TAXE"]);
    expect(naturesARegulariser({})).toEqual([]);
  });
});

describe("§5.3 — tableau d'exigibilité du cahier (jour limite le 20)", () => {
  const cas: [string, string, string, string, boolean][] = [
    ["10/09/2026", "12/09/2026", "2026-10-01", "2026-10-20", false],
    ["28/09/2026", "02/10/2026", "2026-10-01", "2026-10-20", false],
    ["28/09/2026", "25/10/2026", "2026-11-01", "2026-11-20", true],
    ["15/07/2026", "10/09/2026", "2026-09-01", "2026-09-20", true],
    ["15/07/2026", "20/09/2026", "2026-10-01", "2026-10-20", true],
  ];
  it.each(cas)("payé le %s, pris en compte le %s → exigible %s, à reverser avant le %s (régularisation : %s)", (p, pc, mois, limite, regul) => {
    const e = calculerExigibilite(jour(p), jour(pc), PARAMS);
    expect([iso(e.moisExigibilite), iso(e.dateLimite), e.estRegularisation]).toEqual([mois, limite, regul]);
  });
});

describe("Limites — exigibilité", () => {
  it("reprise initiale : prise en compte = date de paiement, jamais de régularisation", () => {
    for (const d of ["01/01/2026", "19/03/2026", "20/03/2026", "31/08/2026", "31/12/2026"]) {
      const e = calculerExigibiliteReprise(jour(d), PARAMS);
      const attendu = new Date(Date.UTC(jour(d).getUTCFullYear(), jour(d).getUTCMonth() + 1, 1));
      expect([iso(e.moisExigibilite), e.estRegularisation]).toEqual([iso(attendu), false]);
    }
  });

  it("décembre → janvier de l'année suivante ; prise en compte en décembre le 20 → janvier", () => {
    const e = calculerExigibilite(jour("31/12/2026"), jour("31/12/2026"), PARAMS);
    expect([iso(e.moisExigibilite), iso(e.dateLimite)]).toEqual(["2027-01-01", "2027-01-20"]);
    const f = calculerExigibilite(jour("05/11/2026"), jour("20/12/2026"), PARAMS);
    expect([iso(f.moisExigibilite), f.estRegularisation]).toEqual(["2027-01-01", true]);
  });

  it("jour limite paramétrable, contrôlé entre 1 et 28", () => {
    const e = calculerExigibilite(jour("15/07/2026"), jour("10/09/2026"), { jourLimite: 10 });
    expect([iso(e.moisExigibilite), iso(e.dateLimite)]).toEqual(["2026-10-01", "2026-10-10"]);
    for (const j of [0, 29, 31, 20.5]) attendreErreur(() => calculerExigibilite(jour("15/07/2026"), jour("15/07/2026"), { jourLimite: j }), "PARAMETRE_INVALIDE");
    expect(iso(calculerExigibilite(jour("15/01/2026"), jour("15/01/2026"), { jourLimite: 28 }).dateLimite)).toBe("2026-02-28");
  });

  it("une prise en compte antérieure au paiement est refusée", () => {
    attendreErreur(() => calculerExigibilite(jour("10/09/2026"), jour("09/09/2026"), PARAMS), "DATES_INVALIDES");
  });
});

describe("Limites — encaissements", () => {
  it("contrat soldé en un seul encaissement : tous les montants du fichier", () => {
    const v = calculerVersement(CONTRAT_9_1(), cumulVide(), "1500");
    expect(v.estSoldant).toBe(true);
    expect([f2(v.AA), f2(v.AB), f2(v.AC), f2(v.AD), f2(v.commission), f2(v.honoraires)]).toEqual([
      "0.00", "1398.60", "0.00", "101.40", "251.75", "34.97",
    ]);
  });

  it("trop-perçu : plus refusé ; alerte avec l'excédent, reliquats exacts, excédent non ventilé", () => {
    const v = calculerVersement(CONTRAT_9_1(), cumulVide(), "1600");
    expect([v.estSoldant, f2(v.AA), v.tropPercu && f2(v.tropPercu)]).toEqual([true, "-100.00", "100.00"]);
    expect([f2(v.AB), f2(v.AD), f2(v.commission)]).toEqual(["1398.60", "101.40", "251.75"]);
    const [v1] = enchainer(CONTRAT_9_1(), ["1000"]);
    const v2 = calculerVersement(CONTRAT_9_1(), ajouterAuCumul(cumulVide(), v1), "600");
    expect([v2.estSoldant, v2.tropPercu && f2(v2.tropPercu), f2(v2.AB)]).toEqual([true, "100.00", "466.20"]);
  });

  it("contrat déjà soldé : tout le montant est excédent, rien n'est ventilé", () => {
    const [v1] = enchainer(CONTRAT_9_1(), ["1500"]);
    const v2 = calculerVersement(CONTRAT_9_1(), ajouterAuCumul(cumulVide(), v1), "200");
    expect([v2.estSoldant, v2.tropPercu && f2(v2.tropPercu), f2(v2.AA), f2(v2.AB), f2(v2.AD)]).toEqual([false, "200.00", "-200.00", "0.00", "0.00"]);
  });

  it("montant nul ou négatif refusé", () => {
    attendreErreur(() => calculerVersement(CONTRAT_9_1(), cumulVide(), "0"), "MONTANT_INVALIDE");
    attendreErreur(() => calculerVersement(CONTRAT_9_1(), cumulVide(), "-10"), "MONTANT_INVALIDE");
  });

  it("avenant (D8) : le premier encaissement reste figé, le suivant solde sur les nouveaux totaux", () => {
    const [v1] = enchainer(CONTRAT_9_1(), ["500"]);
    const avenant = contrat("1800", "1678.32", "0", "121.68", "302.10", "41.96");
    const v2 = calculerVersement(avenant, ajouterAuCumul(cumulVide(), v1), "1300");
    expect([v2.estSoldant, f2(v2.AB), f2(v2.AD), f2(v2.commission)]).toEqual([true, "1212.12", "87.88", "218.18"]);
    expect(statutPaiement("500", "400", false)).toBe("TROP_PERCU"); // avenant à la baisse sous l'encaissé : alerte
  });

  it("contrat incohérent (T + U + V ≠ S) : la taxe totale encaissée est celle du fichier (CDC §5.2)", () => {
    const c = contrat("1000", "900", "0", "150", "0", "0");
    const [v1, v2] = enchainer(c, ["500", "500"]);
    expect([f2(v1.AB), f2(v1.AD)]).toEqual(["450.00", "50.00"]);
    expect([f2(v2.AB), f2(v2.AD)]).toEqual(["450.00", "100.00"]);
    expect(f2(v1.AD.plus(v2.AD))).toBe("150.00");
  });
});

describe("9.13 — annulation d'une police de 1 500 dont 500 encaissés (partie calcul)", () => {
  const base = { primeTtc: "1500", encaisse: "500", dateEffet: jourCalendaire(2026, 7, 1), dateEcheance: jourCalendaire(2026, 8, 1) };
  const [v1] = enchainer(CONTRAT_9_1(), ["500"]);

  it("sans effet : tout l'encaissé est remboursé ; taxe non encaissée 67,60 annulée ; commission due ramenée à 0 → 83,92 à régulariser", () => {
    const e = calculerEffetAnnulation("SANS_EFFET", { ...base, dateAnnulation: jourCalendaire(2026, 7, 15) });
    expect([f2(e.primeAcquise), f2(e.remboursement), f2(e.restantDu)]).toEqual(["0.00", "500.00", "0.00"]);
    expect(f2(montant("101.40").minus(v1.AD))).toBe("67.60");
    const apresRemboursement = situationNature("251.75", [v1.commission, v1.commission.negated()], "83.92");
    expect([f2(apresRemboursement.du), f2(apresRemboursement.aRegulariser)]).toEqual(["0.00", "83.92"]);
  });

  it("non-paiement : 1 000 abandonnés, leur taxe 67,60 annulée ; les 500 restent acquis (taxe 33,80, commission 83,92) ; rien à régulariser", () => {
    const e = calculerEffetAnnulation("NON_PAIEMENT", { ...base, dateAnnulation: jourCalendaire(2026, 7, 20) });
    expect([f2(e.primeAcquise), f2(e.remboursement), f2(e.restantDu)]).toEqual(["500.00", "0.00", "0.00"]);
    expect([f2(v1.AD), f2(v1.commission), f2(montant("101.40").minus(v1.AD))]).toEqual(["33.80", "83.92", "67.60"]);
    const s = situationNature("251.75", [v1.commission], "83.92");
    expect(f2(s.aRegulariser)).toBe("0.00");
  });

  it("résiliation (hors cahier) : 1 500 × 15 ÷ 31 = 725,81 acquis ; restant dû 225,81 ; ristourne 774,19 si tout était payé", () => {
    const e = calculerEffetAnnulation("RESILIATION", { ...base, dateAnnulation: jourCalendaire(2026, 7, 16) });
    expect([f2(e.primeAcquise), f2(e.remboursement), f2(e.restantDu)]).toEqual(["725.81", "0.00", "225.81"]);
    const tout = calculerEffetAnnulation("RESILIATION", { ...base, encaisse: "1500", dateAnnulation: jourCalendaire(2026, 7, 16) });
    expect([f2(tout.remboursement), f2(tout.restantDu)]).toEqual(["774.19", "0.00"]);
  });
});

describe("Limites — situation d'une nature (commission, honoraires, accessoires)", () => {
  it("après 500 et 700 : dû 201,40 ; payé 83,92 ; restant 117,48 ; non acquis 50,35", () => {
    const [v1, v2] = enchainer(CONTRAT_9_1(), ["500", "700"]);
    const s = situationNature("251.75", [v1.commission, v2.commission], "83.92");
    expect([f2(s.du), f2(s.paye), f2(s.restantAPayer), f2(s.nonAcquis), f2(s.aRegulariser)]).toEqual([
      "201.40", "83.92", "117.48", "50.35", "0.00",
    ]);
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
    const c = CONTRAT_9_1();
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

describe("DDF et statuts", () => {
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

  it("statut de paiement (CDC §5.6)", () => {
    expect(statutPaiement("0", "1500", false)).toBe("NON_PAYE");
    expect(statutPaiement("500", "1500", false)).toBe("PARTIELLEMENT_PAYE");
    expect(statutPaiement("1500", "1500", false)).toBe("TOTALEMENT_PAYE");
    expect(statutPaiement("1600", "1500", false)).toBe("TROP_PERCU");
    expect(statutPaiement("500", "1500", true)).toBe("ANNULE");
  });
});

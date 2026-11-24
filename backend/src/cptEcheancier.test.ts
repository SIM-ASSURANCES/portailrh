import { describe, expect, it } from "vitest";

import {
  ajouterMoisCpt,
  construireEcheancier,
  enCentimesEcheancier,
  etatAfficheEcheance,
  resteDuContrat,
  texteDepuisCentimes,
  type EcheanceCalculee,
  type EntreeEcheancier,
} from "./cptEcheancier";

const base: EntreeEcheancier = {
  fractionnement: "MENSUEL",
  dateEffet: "2026-01-01",
  dateEcheance: "2026-12-31",
  primeTtc: "6077832",
  accessoires: "0",
  taxe: "0",
};

function echeances(entree: EntreeEcheancier): EcheanceCalculee[] {
  const r = construireEcheancier(entree);
  if (!r.ok) throw new Error(r.erreur);
  return r.echeances;
}
const somme = (lignes: EcheanceCalculee[], champ: "primeTtc" | "primeHt" | "accessoires" | "taxe") =>
  lignes.reduce((a, l) => a + enCentimesEcheancier(l[champ])!, BigInt(0));

describe("montants", () => {
  it("centimes entiers depuis un texte ou un nombre, virgule ou point", () => {
    expect(enCentimesEcheancier("506486")).toBe(BigInt(50648600));
    expect(enCentimesEcheancier("12,5")).toBe(BigInt(1250));
    expect(enCentimesEcheancier("12.05")).toBe(BigInt(1205));
    expect(enCentimesEcheancier(7.25)).toBe(BigInt(725));
  });

  it("refuse ce qui n'est pas un montant à deux décimales au plus", () => {
    for (const mauvais of ["12.345", "abc", "", "-5", "1 000", NaN, null, undefined]) {
      expect(enCentimesEcheancier(mauvais as never)).toBeNull();
    }
  });

  it("texte à deux décimales", () => {
    expect(texteDepuisCentimes(BigInt(50648600))).toBe("506486.00");
    expect(texteDepuisCentimes(BigInt(5))).toBe("0.05");
  });
});

describe("dates", () => {
  it("garde le jour, ramené à la fin du mois quand il n'existe pas", () => {
    expect(ajouterMoisCpt("2026-01-31", 1)).toBe("2026-02-28");
    expect(ajouterMoisCpt("2028-01-31", 1)).toBe("2028-02-29");
    expect(ajouterMoisCpt("2026-11-15", 3)).toBe("2027-02-15");
  });
});

describe("échéancier périodique (T12 : 6 077 832 en 12 × 506 486)", () => {
  it("douze mensualités exactes, périodes contiguës sur l'année", () => {
    const l = echeances(base);
    expect(l).toHaveLength(12);
    expect(l.every((e) => e.primeTtc === "506486.00" && e.montantDu === "506486.00")).toBe(true);
    expect(somme(l, "primeTtc")).toBe(BigInt(607783200));
    expect(l[0]).toMatchObject({ rang: 1, periodeDebut: "2026-01-01", periodeFin: "2026-01-31", datePrevue: "2026-01-01" });
    expect(l[1]).toMatchObject({ rang: 2, periodeDebut: "2026-02-01", periodeFin: "2026-02-28" });
    expect(l[11]).toMatchObject({ rang: 12, periodeDebut: "2026-12-01", periodeFin: "2026-12-31" });
    for (let i = 1; i < l.length; i++) {
      expect(l[i].periodeDebut > l[i - 1].periodeFin).toBe(true);
    }
  });

  it("l'écart d'arrondi est absorbé : 100,01 en 3 mois = 33,34 + 33,33 + 33,34", () => {
    const l = echeances({ ...base, dateEcheance: "2026-03-31", primeTtc: "100.01" });
    expect(l.map((e) => e.primeTtc)).toEqual(["33.34", "33.33", "33.34"]);
    expect(somme(l, "primeTtc")).toBe(BigInt(10001));
  });

  it("trimestriel, semestriel et comptant", () => {
    expect(echeances({ ...base, fractionnement: "TRIMESTRIEL" })).toHaveLength(4);
    expect(echeances({ ...base, fractionnement: "SEMESTRIEL" }).map((e) => e.datePrevue)).toEqual(["2026-01-01", "2026-07-01"]);
    const c = echeances({ ...base, fractionnement: "COMPTANT" });
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ rang: 1, periodeDebut: "2026-01-01", periodeFin: "2026-12-31", primeTtc: "6077832.00" });
  });

  it("une durée qui n'est pas un multiple du pas donne une dernière période plus courte", () => {
    const l = echeances({ ...base, fractionnement: "TRIMESTRIEL", dateEcheance: "2026-05-31", primeTtc: "1000" });
    expect(l).toHaveLength(2);
    expect(l[1]).toMatchObject({ periodeDebut: "2026-04-01", periodeFin: "2026-05-31" });
  });

  it("accessoires, taxe et part hors taxe : somme exacte de chaque colonne et cohérence de chaque ligne", () => {
    const l = echeances({ ...base, primeTtc: "6077832", accessoires: "12000.10", taxe: "100001.07" });
    expect(somme(l, "accessoires")).toBe(BigInt(1200010));
    expect(somme(l, "taxe")).toBe(BigInt(10000107));
    expect(somme(l, "primeHt")).toBe(BigInt(607783200) - BigInt(1200010) - BigInt(10000107));
    for (const e of l) {
      expect(enCentimesEcheancier(e.primeHt)! + enCentimesEcheancier(e.accessoires)! + enCentimesEcheancier(e.taxe)!).toBe(enCentimesEcheancier(e.primeTtc));
    }
  });
});

describe("fractionnement libre (T3 : groupe santé 250 000 en échéances de 50 000)", () => {
  const libre: EntreeEcheancier = {
    fractionnement: "LIBRE",
    dateEffet: "2026-01-01",
    dateEcheance: "2026-12-31",
    primeTtc: "250000",
    accessoires: "5000",
    taxe: "3750",
    lignesLibres: [
      { datePrevue: "2026-01-01", primeTtc: "50000" },
      { datePrevue: "2026-03-01", primeTtc: "50000" },
      { datePrevue: "2026-05-01", primeTtc: "50000" },
      { datePrevue: "2026-07-01", primeTtc: "50000" },
      { datePrevue: "2026-09-01", primeTtc: "50000" },
    ],
  };

  it("cinq échéances, somme = prime, composantes réparties au prorata", () => {
    const l = echeances(libre);
    expect(l).toHaveLength(5);
    expect(l.map((e) => e.montantDu)).toEqual(Array(5).fill("50000.00"));
    expect(l.every((e) => e.accessoires === "1000.00" && e.taxe === "750.00" && e.primeHt === "48250.00")).toBe(true);
    expect(l[0]).toMatchObject({ periodeDebut: "2026-01-01", periodeFin: "2026-02-28" });
    expect(l[4]).toMatchObject({ periodeDebut: "2026-09-01", periodeFin: "2026-12-31" });
  });

  it("reste dû 200 000 après un premier paiement de 50 000", () => {
    const lignes = echeances(libre).map((e, i) => ({ etat: (i === 0 ? "SOLDEE" : "OUVERTE") as "SOLDEE" | "OUVERTE", datePrevue: e.datePrevue, montantDu: e.montantDu, montantRegle: i === 0 ? "50000" : "0" }));
    expect(resteDuContrat(lignes)).toBe(BigInt(20000000));
  });

  it("refuse une somme différente de la prime, une liste vide, des dates désordonnées, un montant nul", () => {
    expect(construireEcheancier({ ...libre, primeTtc: "260000" })).toMatchObject({ ok: false });
    expect(construireEcheancier({ ...libre, lignesLibres: [] })).toMatchObject({ ok: false });
    expect(construireEcheancier({ ...libre, lignesLibres: [libre.lignesLibres![1], libre.lignesLibres![0], ...libre.lignesLibres!.slice(2)] })).toMatchObject({ ok: false });
    expect(construireEcheancier({ ...libre, lignesLibres: [{ datePrevue: "2026-01-01", primeTtc: "0" }, ...libre.lignesLibres!.slice(1)] })).toMatchObject({ ok: false });
    expect(construireEcheancier({ ...libre, lignesLibres: undefined })).toMatchObject({ ok: false });
  });
});

describe("entrées incohérentes", () => {
  it("rien n'est produit : dates, montants, accessoires + taxe supérieurs à la prime", () => {
    const refus = (e: Partial<EntreeEcheancier>) => construireEcheancier({ ...base, ...e });
    expect(refus({ dateEffet: "2026-02-30" })).toMatchObject({ ok: false, erreurs: { dateEffet: expect.any(String) } });
    expect(refus({ dateEcheance: "2025-12-31" })).toMatchObject({ ok: false, erreurs: { dateEcheance: expect.any(String) } });
    expect(refus({ primeTtc: "abc" })).toMatchObject({ ok: false, erreurs: { primeTtc: expect.any(String) } });
    expect(refus({ accessoires: "4000000", taxe: "4000000" })).toMatchObject({ ok: false, erreurs: { primeTtc: expect.any(String) } });
    expect(refus({ fractionnement: "MENSUEL", dateEffet: "2026-01-01", dateEcheance: "2026-01-10" })).toMatchObject({ ok: false });
  });
});

describe("états affichés", () => {
  const e = (etat: "OUVERTE" | "SOLDEE" | "ANNULEE", datePrevue: string, du: string, regle: string) => ({ etat, datePrevue, montantDu: du, montantRegle: regle });
  const AUJ = "2026-08-20";

  it("à venir, due le jour même, en retard de n jours", () => {
    expect(etatAfficheEcheance(e("OUVERTE", "2026-09-01", "100", "0"), AUJ)).toMatchObject({ etat: "A_VENIR", libelle: "À venir", resteDu: BigInt(10000) });
    expect(etatAfficheEcheance(e("OUVERTE", AUJ, "100", "0"), AUJ).etat).toBe("DUE");
    const retard = etatAfficheEcheance(e("OUVERTE", "2026-08-10", "100", "0"), AUJ);
    expect(retard).toMatchObject({ etat: "EN_RETARD", joursRetard: 10, libelle: "En retard de 10 jours" });
    expect(etatAfficheEcheance(e("OUVERTE", "2026-08-19", "100", "0"), AUJ).libelle).toBe("En retard de 1 jour");
  });

  it("payée, partiellement payée, annulée", () => {
    expect(etatAfficheEcheance(e("SOLDEE", "2026-08-10", "100", "100"), AUJ)).toMatchObject({ etat: "PAYEE", resteDu: BigInt(0) });
    expect(etatAfficheEcheance(e("OUVERTE", AUJ, "100", "40"), AUJ)).toMatchObject({ etat: "PARTIELLEMENT_PAYEE", resteDu: BigInt(6000) });
    expect(etatAfficheEcheance(e("OUVERTE", "2026-08-10", "100", "40"), AUJ).etat).toBe("EN_RETARD");
    expect(etatAfficheEcheance(e("ANNULEE", "2026-08-10", "100", "0"), AUJ)).toMatchObject({ etat: "ANNULEE", resteDu: BigInt(0) });
  });

  it("T12 : août en retard, deux payées, reste dû 5 064 860", () => {
    const l = echeances(base).map((x, i) => e(i < 2 ? "SOLDEE" : "OUVERTE", x.datePrevue, x.montantDu, i < 2 ? x.montantDu : "0"));
    expect(l.filter((x) => x.etat === "SOLDEE")).toHaveLength(2);
    expect(resteDuContrat(l)).toBe(BigInt(506486000));
    const aout = etatAfficheEcheance(l[7], "2026-09-15");
    expect(aout).toMatchObject({ etat: "EN_RETARD", joursRetard: 45 });
  });

  it("le reste dû ignore les échéances annulées et ne devient jamais négatif", () => {
    expect(resteDuContrat([e("ANNULEE", "2026-01-01", "100", "0"), e("OUVERTE", "2026-02-01", "100", "30"), e("OUVERTE", "2026-03-01", "100", "150")])).toBe(BigInt(7000));
  });
});

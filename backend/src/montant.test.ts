import { describe, expect, it } from "vitest";

import {
  analyserMontant,
  deviseAvecDecimales,
  formaterSaisieMontant,
  grouperMilliers,
  libelleMontant,
  lireMontant,
  reformaterSaisieMontant,
} from "./montant";

const FCFA = { devise: "XOF" };
const EUR = { devise: "EUR" };

function valeur(saisie: string, options = FCFA): number {
  const r = analyserMontant(saisie, options);
  if (!r.ok) throw new Error(`« ${saisie} » refusé : ${r.message}`);
  return r.valeur;
}
function refus(saisie: string, options = FCFA): string {
  const r = analyserMontant(saisie, options);
  if (r.ok) throw new Error(`« ${saisie} » accepté (${r.canonique}) alors qu'il devrait être refusé`);
  return r.message;
}

describe("devises", () => {
  it("FCFA, XOF, XAF sans décimale ; EUR, USD avec", () => {
    expect(deviseAvecDecimales("XOF")).toBe(false);
    expect(deviseAvecDecimales("fcfa")).toBe(false);
    expect(deviseAvecDecimales("XAF")).toBe(false);
    expect(deviseAvecDecimales("EUR")).toBe(true);
    expect(deviseAvecDecimales("USD")).toBe(true);
    expect(deviseAvecDecimales(undefined)).toBe(false);
  });
});

describe("analyserMontant — exemples de la consigne (FCFA)", () => {
  it.each([
    ["1500000", 1500000],
    ["1 500 000", 1500000],
    ["1.500.000", 1500000],
    ["1 500 000", 1500000], // espace insécable
    ["1 500 000", 1500000], // espace insécable fine
    ["  1500  ", 1500],
    ["0", 0],
    ["007", 7],
    ["1.500", 1500], // ambigu tranché : FCFA = milliers
    ["1 500.000", 1500000], // espace et point mélangés comme milliers
  ])("%j → %d", (saisie, attendu) => {
    expect(valeur(saisie)).toBe(attendu);
  });

  it("FCFA : une virgule suivie de chiffres est refusée, même « ,00 »", () => {
    for (const s of ["1.500.000,50", "1 500 000,50", "1500000,5", "1500,00", "1,5"]) {
      expect(refus(s)).toMatch(/décimales ne sont pas admises/);
    }
  });

  it("FCFA : un point suivi de 1 ou 2 chiffres est un groupe de milliers mal formé", () => {
    expect(refus("1.50")).toMatch(/milliers/);
    expect(refus("1.5")).toMatch(/milliers/);
    expect(refus("12 34")).toMatch(/milliers/);
  });
});

describe("analyserMontant — devise à décimales (EUR)", () => {
  it.each([
    ["1500000", 1500000],
    ["1 500 000", 1500000],
    ["1.500.000", 1500000],
    ["1.500.000,50", 1500000.5],
    ["1 500 000,50", 1500000.5],
    ["1500000,5", 1500000.5],
    ["1500.5", 1500.5],
    ["1500.50", 1500.5],
    ["1,5", 1.5],
    ["1.5", 1.5],
    ["0,5", 0.5],
    ["0.50", 0.5],
    ["1 500,05", 1500.05],
    ["1.500", 1500], // ambigu tranché : exactement trois chiffres après le séparateur = milliers
    ["12.345", 12345],
  ])("%j → %d", (saisie, attendu) => {
    expect(valeur(saisie, EUR)).toBe(attendu);
  });

  it("les centimes sont exacts", () => {
    const r = analyserMontant("1 500 000,05", EUR);
    expect(r.ok && r.centimes).toBe(150000005);
    expect(r.ok && r.canonique).toBe("1500000.05");
    const r2 = analyserMontant("0,1", EUR);
    expect(r2.ok && r2.centimes).toBe(10);
  });

  it("virgule suivie de trois chiffres : ambigu, refusé avec un message clair", () => {
    expect(refus("1,500", EUR)).toMatch(/ambigu/);
  });

  it("style anglo-saxon « 1,500.50 » et séparateurs mélangés : refusés", () => {
    expect(refus("1,500.50", EUR)).toMatch(/mélangés/);
    expect(refus("1.500.50", EUR)).toMatch(/Séparateurs mal placés/);
    expect(refus("1,500,50", EUR)).toMatch(/Séparateurs/);
  });

  it("plus de deux décimales : refusé", () => {
    expect(refus("1,5000", EUR)).toMatch(/Deux décimales/);
    expect(refus("1.5000", EUR)).toMatch(/Deux décimales/);
  });

  it("zéro suivi d'un groupe de milliers : ambigu, refusé", () => {
    expect(refus("0.500", EUR)).toMatch(/ambigu/);
    expect(refus("0.500")).toMatch(/ambigu/);
  });
});

describe("analyserMontant — refus communs", () => {
  it.each(["", "   ", "abc", "12a", "1e5", "1E6", "$100", "1 500 FCFA", "1_500", "1/2"])("%j refusé", (s) => {
    const message = refus(s);
    expect(message.length).toBeGreaterThan(5);
  });

  it("signes négatifs et plus : refusés avec un message dédié", () => {
    expect(refus("-500")).toMatch(/négatif/);
    expect(refus("−500")).toMatch(/négatif/);
    expect(refus("1 500-")).toMatch(/négatif/);
    expect(refus("+500")).toMatch(/chiffres/);
  });

  it.each(["1..500", "1.,500", "1,,5", "1  500", ".500", ",5", " .5", "1. 500", "1 .500"])("séparateurs mal placés %j refusés", (s) => {
    refus(s, EUR);
    refus(s);
  });

  it("séparateur final : montant incomplet", () => {
    expect(refus("1500,", EUR)).toMatch(/incomplet/);
    expect(refus("1500.", EUR)).toMatch(/incomplet/);
  });

  it("groupes de milliers mal formés", () => {
    expect(refus("1.50.000")).toMatch(/milliers/);
    expect(refus("1 5000 000")).toMatch(/milliers/);
    expect(refus("1234 567")).toMatch(/milliers/);
    expect(refus("1.5000")).toMatch(/milliers/);
  });

  it("montant trop grand", () => {
    expect(refus("1 000 000 000 000 000")).toMatch(/trop élevé/);
  });

  it("l'espace de fin est ignorée", () => {
    expect(valeur("1 500 ")).toBe(1500);
  });
});

describe("lireMontant (serveur) — texte brut ou nombre", () => {
  it("accepte un nombre normalisé, refuse NaN/Infinity/négatif/trop de décimales", () => {
    expect(lireMontant(1500000, FCFA).ok).toBe(true);
    expect(lireMontant(1500.5, EUR).ok).toBe(true);
    expect(lireMontant(Number.NaN).ok).toBe(false);
    expect(lireMontant(Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(lireMontant(-1).ok).toBe(false);
    const trop = lireMontant(1.234, EUR);
    expect(trop.ok).toBe(false);
    const fcfaDecimal = lireMontant(1500.5, FCFA);
    expect(fcfaDecimal.ok).toBe(false);
  });
  it("un texte repasse par la même règle que l'écran", () => {
    const r = lireMontant("1 500 000", FCFA);
    expect(r.ok && r.valeur).toBe(1500000);
    expect(lireMontant("1.500.000,50", FCFA).ok).toBe(false);
    expect(lireMontant(undefined).ok).toBe(false);
    expect(lireMontant(null).ok).toBe(false);
    expect(lireMontant({}).ok).toBe(false);
  });
  it("nombre : zéro admis (la positivité est contrôlée par l'appelant)", () => {
    const r = lireMontant(0);
    expect(r.ok && r.centimes).toBe(0);
  });
});

describe("formatage pendant la frappe", () => {
  it("groupe les milliers et conserve la virgule décimale", () => {
    expect(formaterSaisieMontant("1500000", FCFA)).toBe("1 500 000");
    expect(formaterSaisieMontant("1.500.000", FCFA)).toBe("1 500 000");
    expect(formaterSaisieMontant("1500000,5", EUR)).toBe("1 500 000,5");
    expect(formaterSaisieMontant("1.500.000,50", EUR)).toBe("1 500 000,50");
    expect(formaterSaisieMontant("1500.5", EUR)).toBe("1 500,5");
  });
  it("laisse intacte une saisie invalide ou incomplète", () => {
    expect(formaterSaisieMontant("1 500.", FCFA)).toBe("1 500.");
    expect(formaterSaisieMontant("12a", FCFA)).toBe("12a");
    expect(formaterSaisieMontant("1,5", FCFA)).toBe("1,5");
    expect(formaterSaisieMontant("", FCFA)).toBe("");
  });
  it("garde le curseur au même rang de chiffre", () => {
    // « 1234| » → « 1 234| »
    expect(reformaterSaisieMontant("1234", 4, FCFA)).toEqual({ texte: "1 234", curseur: 5 });
    // « 12|34 » → « 1 2|34 » : deux chiffres avant le curseur
    expect(reformaterSaisieMontant("1234", 2, FCFA)).toEqual({ texte: "1 234", curseur: 3 });
    // collage d'Excel
    expect(reformaterSaisieMontant("1.500.000", 9, FCFA)).toEqual({ texte: "1 500 000", curseur: 9 });
    // déjà formaté : inchangé
    expect(reformaterSaisieMontant("1 234", 3, FCFA)).toEqual({ texte: "1 234", curseur: 3 });
  });

  // Frappe réelle, caractère par caractère, curseur en fin de champ (régression trouvée par le test de bout en bout du lot M :
  // « 1 500 » + « 0 » donne « 1 5000 », qui doit être regroupé et non laissé tel quel).
  const taper = (chaine: string, options: Parameters<typeof reformaterSaisieMontant>[2]) => {
    let t = "";
    for (const c of chaine) {
      const brut = t + c;
      t = reformaterSaisieMontant(brut, brut.length, options).texte;
    }
    return t;
  };
  it("frappe au clavier : les milliers se regroupent au fil de la saisie", () => {
    expect(taper("1500000", FCFA)).toBe("1 500 000");
    expect(taper("123456789012", FCFA)).toBe("123 456 789 012");
    expect(taper("1.500.000", FCFA)).toBe("1 500 000");
    expect(taper("1500000,5", EUR)).toBe("1 500 000,5");
    expect(taper("1500000,50", EUR)).toBe("1 500 000,50");
    expect(taper("500", FCFA)).toBe("500");
  });
  it("frappe au clavier : une saisie invalide reste visible telle quelle (jamais corrigée en silence)", () => {
    expect(taper("1500000,5", FCFA)).toBe("1 500 000,5");
    expect(taper("12abc", FCFA)).toBe("12abc");
    expect(taper("1,2345", EUR)).toBe("1,2345");
    // saisie invalide : inchangée
    expect(reformaterSaisieMontant("12a", 3, FCFA)).toEqual({ texte: "12a", curseur: 3 });
  });
});

describe("écho et groupes", () => {
  it("grouperMilliers", () => {
    expect(grouperMilliers("1500000")).toBe("1 500 000");
    expect(grouperMilliers("500")).toBe("500");
    expect(grouperMilliers("1000")).toBe("1 000");
  });
  it("libellé d'écho", () => {
    expect(libelleMontant(1500000, "XOF")).toBe("1 500 000 FCFA");
    expect(libelleMontant(1500.5, "EUR")).toBe("1 500,5 EUR");
    expect(libelleMontant(1500.05, "EUR")).toBe("1 500,05 EUR");
    expect(libelleMontant(0, undefined)).toBe("0 FCFA");
  });
});

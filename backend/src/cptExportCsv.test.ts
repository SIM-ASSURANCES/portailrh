import { describe, expect, it } from "vitest";

import {
  celluleCsv,
  centimesExport,
  type ColonneExportCpt,
  CSV_FIN_DE_LIGNE,
  enteteCsv,
  jourCivilExport,
  ligneCsv,
  montantDepuisCentimes,
  neutraliserFormule,
} from "./cptExportCsv";

describe("neutraliserFormule : le texte qu'Excel exécuterait", () => {
  it.each(["=1+1", "+225 07 00", "-2+3", "@SUM(A1)", "\tx", "\rx", '=HYPERLINK("http://x")'])("préfixe « %s »", (texte) => {
    expect(neutraliserFormule(texte)).toBe(`'${texte}`);
  });

  it("laisse un texte ordinaire intact, même avec un signe au milieu", () => {
    for (const texte of ["Dupont", "a=b", "100-200", " =x", "N'Guessan"]) expect(neutraliserFormule(texte)).toBe(texte);
  });
});

describe("celluleCsv", () => {
  it("un montant négatif reste un nombre : jamais préfixé comme une formule", () => {
    expect(celluleCsv(-250, "montant")).toBe("-250,00");
    expect(celluleCsv("-1398.6", "montant")).toBe("-1398,60");
  });

  it("un montant s'écrit avec deux décimales et la virgule décimale, sans erreur de flottant", () => {
    expect(celluleCsv(1500000.5, "montant")).toBe("1500000,50");
    expect(celluleCsv(0.1 + 0.2, "montant")).toBe("0,30");
    expect(celluleCsv("12", "montant")).toBe("12,00");
    expect(celluleCsv(-0.004, "montant")).toBe("0,00");
  });

  it("un montant illisible devient une cellule vide, jamais « NaN »", () => {
    for (const v of ["abc", "1,5", NaN, Infinity]) expect(celluleCsv(v, "montant"), String(v)).toBe("");
  });

  it("un texte est neutralisé puis protégé par des guillemets s'il contient un séparateur, un guillemet ou un saut de ligne", () => {
    expect(celluleCsv("=1+1", "texte")).toBe("'=1+1");
    expect(celluleCsv("a;b", "texte")).toBe('"a;b"');
    expect(celluleCsv('dit "oui"', "texte")).toBe('"dit ""oui"""');
    expect(celluleCsv("ligne1\nligne2", "texte")).toBe('"ligne1\nligne2"');
    expect(celluleCsv('=A;"x"', "texte")).toBe(`"'=A;""x"""`);
  });

  it("une date est un jour civil UTC (colonne @db.Date de Prisma) ou une chaîne ISO", () => {
    expect(celluleCsv(new Date(Date.UTC(2026, 9, 25)), "date")).toBe("2026-10-25");
    expect(celluleCsv("2026-01-05", "date")).toBe("2026-01-05");
    expect(celluleCsv("05/01/2026", "date")).toBe("");
    expect(celluleCsv(new Date(NaN), "date")).toBe("");
  });

  it("un entier s'écrit sans notation scientifique", () => {
    expect(celluleCsv(7123456789, "entier")).toBe("7123456789");
    expect(celluleCsv("12", "entier")).toBe("");
  });

  it("une valeur absente est une cellule vide", () => {
    for (const v of [null, undefined, ""]) expect(celluleCsv(v, "texte")).toBe("");
  });
});

describe("lignes et en-têtes", () => {
  const colonnes: ColonneExportCpt[] = [
    { cle: "ref", titre: "Référence", type: "texte" },
    { cle: "date", titre: "Date", type: "date" },
    { cle: "montant", titre: "Montant (FCFA)", type: "montant" },
  ];

  it("assemble une ligne avec « ; » et « \\r\\n », dans l'ordre des colonnes, en ignorant les clés en trop", () => {
    expect(ligneCsv(colonnes, { montant: -5, ref: "CPE-1", date: "2026-02-03", autre: "x" })).toBe(`CPE-1;2026-02-03;-5,00${CSV_FIN_DE_LIGNE}`);
  });

  it("une clé absente donne une cellule vide", () => {
    expect(ligneCsv(colonnes, { ref: "A" })).toBe(`A;;${CSV_FIN_DE_LIGNE}`);
  });

  it("écrit les titres", () => {
    expect(enteteCsv(colonnes)).toBe(`Référence;Date;Montant (FCFA)${CSV_FIN_DE_LIGNE}`);
  });
});

describe("outils", () => {
  it("jourCivilExport lit les composantes UTC, quel que soit le fuseau", () => {
    expect(jourCivilExport(new Date(Date.UTC(2026, 11, 31)))).toEqual({ a: 2026, m: 12, j: 31 });
    expect(jourCivilExport("2026-02-03")).toEqual({ a: 2026, m: 2, j: 3 });
    expect(jourCivilExport("hier")).toBeNull();
  });

  it("centimesExport / montantDepuisCentimes", () => {
    expect(centimesExport("-1398.6")).toBe(-139860);
    expect(montantDepuisCentimes(-139860)).toBe("-1398.60");
    expect(montantDepuisCentimes(5, ",")).toBe("0,05");
  });
});

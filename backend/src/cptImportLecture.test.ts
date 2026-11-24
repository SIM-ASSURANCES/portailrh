import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import type { ColonneFormatCpt, DefinitionFormatCpt } from "./cptFormatImport";
import {
  CPT_IMPORT_ANOMALIES_DETAILLEES_MAX,
  CptImportLectureError,
  detecterTypeTableurCpt,
  lireTableurSelonFormat,
} from "./cptImportLecture";

// ---------- Fabrication de fichiers synthétiques (jamais de donnée réelle) ----------

type Cel = string | number | null | { jour: [number, number, number] };
/** Numéro de série Excel du jour civil (sans heure, donc sans fuseau). */
const serie = (a: number, m: number, j: number) => Math.round(Date.UTC(a, m - 1, j) / 86_400_000) + 25_569;

function feuille(lignes: Cel[][], premiereLigne = 1): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  let largeur = 1;
  lignes.forEach((ligne, r) => {
    largeur = Math.max(largeur, ligne.length);
    ligne.forEach((c, k) => {
      if (c === null) return;
      const adresse = XLSX.utils.encode_cell({ r: r + premiereLigne - 1, c: k });
      if (typeof c === "string") ws[adresse] = { t: "s", v: c };
      else if (typeof c === "number") ws[adresse] = { t: "n", v: c };
      else ws[adresse] = { t: "n", v: serie(...c.jour), z: "dd/mm/yyyy" };
    });
  });
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: premiereLigne - 1, c: 0 }, e: { r: premiereLigne - 2 + lignes.length, c: largeur - 1 } });
  return ws;
}

function xlsx(lignes: Cel[][], premiereLigne = 1): Buffer {
  const wb: XLSX.WorkBook = { SheetNames: ["F"], Sheets: { F: feuille(lignes, premiereLigne) } };
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const csv = (texte: string, encodage: BufferEncoding = "utf8") => Buffer.from(texte, encodage);

const c = (entete: string, champ: string, type: ColonneFormatCpt["type"] = "texte", extra: Partial<ColonneFormatCpt> = {}): ColonneFormatCpt => ({
  entete,
  champ,
  type,
  obligatoire: false,
  ...extra,
});
const format = (colonnes: ColonneFormatCpt[], ligneEntete = 1): DefinitionFormatCpt => ({ ligneEntete, colonnes });

const FORMAT_RELEVE = format([
  c("Date", "date", "date", { formatDate: "JJ/MM/AAAA", obligatoire: true }),
  c("Libellé", "libelle"),
  c("Montant", "montant", "montant", { obligatoire: true }),
]);

// ---------- Détection du type ----------

describe("detecterTypeTableurCpt : d'après le contenu, jamais le nom", () => {
  it("reconnaît xlsx (ZIP), xls (OLE2) et csv (texte)", () => {
    expect(detecterTypeTableurCpt(xlsx([["A"], ["b"]]))).toBe("xlsx");
    expect(detecterTypeTableurCpt(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe("xls");
    expect(detecterTypeTableurCpt(csv("Date;Montant\n01/01/2026;5\n"))).toBe("csv");
  });

  it("refuse le vide et tout contenu binaire (octet nul)", () => {
    expect(detecterTypeTableurCpt(new Uint8Array(0))).toBeNull();
    expect(detecterTypeTableurCpt(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]))).toBeNull();
  });

  it("refuse un PDF, une image ou un RTF même sans octet nul (un PDF « texte » n'est pas un CSV)", () => {
    expect(detecterTypeTableurCpt(csv("%PDF-1.4\n%synthétique\n"))).toBeNull();
    expect(detecterTypeTableurCpt(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
    expect(detecterTypeTableurCpt(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x41, 0x42]))).toBeNull();
    expect(detecterTypeTableurCpt(csv("GIF89a texte"))).toBeNull();
    expect(detecterTypeTableurCpt(csv("{\\rtf1\\ansi un document"))).toBeNull();
  });

  it("ne refuse pas un CSV qui contient seulement ces lettres ailleurs qu'au début", () => {
    expect(detecterTypeTableurCpt(csv("Type;Note\nPDF;%PDF- dans une cellule\n"))).toBe("csv");
    expect(detecterTypeTableurCpt(csv("PDF;GIF;PNG\n1;2;3\n"))).toBe("csv");
  });
});

// ---------- Colonnes retrouvées par en-tête ----------

describe("lecture par en-têtes", () => {
  it("retrouve les colonnes quel que soit leur ordre et signale les colonnes en trop", () => {
    const r = lireTableurSelonFormat(
      xlsx([
        ["Solde", "Montant", "Libellé", "Date", "Note"],
        [10, -250, "Frais", { jour: [2026, 10, 25] }, "x"],
      ]),
      FORMAT_RELEVE
    );
    expect(r.lignes).toEqual([{ numeroLigne: 2, valeurs: { date: "2026-10-25", libelle: "Frais", montant: "-250.00" } }]);
    expect(r.enTetesNonUtilises).toEqual(["Solde", "Note"]);
    expect(r.anomalies).toEqual([]);
  });

  it("tolère un en-tête écrit avec une autre casse et des espaces autour", () => {
    const r = lireTableurSelonFormat(xlsx([["  DATE ", "montant", "LIBELLÉ"], [{ jour: [2026, 1, 5] }, 7, "a"]]), FORMAT_RELEVE);
    expect(r.lignes[0].valeurs).toEqual({ date: "2026-01-05", libelle: "a", montant: "7.00" });
  });

  it("une colonne facultative absente donne null et est signalée, sans erreur", () => {
    const r = lireTableurSelonFormat(xlsx([["Date", "Montant"], [{ jour: [2026, 1, 5] }, 7]]), FORMAT_RELEVE);
    expect(r.lignes[0].valeurs.libelle).toBeNull();
    expect(r.colonnesFacultativesAbsentes).toEqual(["Libellé"]);
  });

  it("une colonne obligatoire absente arrête la lecture avec les en-têtes trouvés", () => {
    expect(() => lireTableurSelonFormat(xlsx([["Date", "Libellé"], [{ jour: [2026, 1, 5] }, "a"]]), FORMAT_RELEVE)).toThrow(
      /obligatoire\(s\) introuvable\(s\).*« Montant ».*« Date », « Libellé »/
    );
  });

  it("une cellule obligatoire vide est une anomalie de la ligne, pas une erreur du fichier", () => {
    const r = lireTableurSelonFormat(xlsx([["Date", "Libellé", "Montant"], [{ jour: [2026, 1, 5] }, "a", null]]), FORMAT_RELEVE);
    expect(r.lignes[0].valeurs.montant).toBeNull();
    expect(r.anomalies).toEqual([{ numeroLigne: 2, champ: "montant", entete: "Montant", valeurBrute: "", motif: "valeur obligatoire absente" }]);
  });
});

describe("numéros de ligne : ceux que l'utilisateur voit dans le tableur", () => {
  it("compte les lignes de titre avant l'en-tête et saute les lignes vides sans les décaler", () => {
    const r = lireTableurSelonFormat(
      xlsx([["Relevé du mois"], [], ["Date", "Libellé", "Montant"], [{ jour: [2026, 1, 5] }, "a", 1], [null, null, null], [{ jour: [2026, 1, 6] }, "b", "xx"]]),
      { ...FORMAT_RELEVE, ligneEntete: 3 }
    );
    expect(r.lignes.map((l) => l.numeroLigne)).toEqual([4, 6]);
    expect(r.nbLignesVidesIgnorees).toBe(1);
    expect(r.anomalies[0]).toMatchObject({ numeroLigne: 6, champ: "montant" });
  });

  it("garde les numéros justes quand la feuille ne commence pas en A1", () => {
    const r = lireTableurSelonFormat(xlsx([["Date", "Libellé", "Montant"], [{ jour: [2026, 1, 5] }, "a", 1]], 3), { ...FORMAT_RELEVE, ligneEntete: 3 });
    expect(r.lignes).toHaveLength(1);
    expect(r.lignes[0].numeroLigne).toBe(4);
  });

  it("refuse une ligne d'en-têtes vide", () => {
    expect(() => lireTableurSelonFormat(xlsx([["Date", "Montant"], [{ jour: [2026, 1, 5] }, 1]]), { ...FORMAT_RELEVE, ligneEntete: 5 })).toThrow(
      /Aucun en-tête trouvé à la ligne 5/
    );
  });
});

// ---------- Dates ----------

describe("dates : jamais devinées", () => {
  const lire = (texte: string, formatDate?: ColonneFormatCpt["formatDate"]) =>
    lireTableurSelonFormat(csv(`Date;Libellé\n${texte};x\n`), format([c("Date", "date", "date", formatDate ? { formatDate } : {})]));

  it("un CSV n'est pas « deviné » à l'américaine : 03/04/2026 est le 3 avril en JJ/MM/AAAA", () => {
    expect(lire("03/04/2026", "JJ/MM/AAAA").lignes[0].valeurs.date).toBe("2026-04-03");
  });

  it("… et le 4 mars seulement si le format le déclare (MM/JJ/AAAA)", () => {
    expect(lire("03/04/2026", "MM/JJ/AAAA").lignes[0].valeurs.date).toBe("2026-03-04");
  });

  it("sans format déclaré, une date jour/mois est une anomalie, pas un pari", () => {
    const r = lire("03/04/2026");
    expect(r.lignes[0].valeurs.date).toBeNull();
    expect(r.anomalies[0].motif).toMatch(/aucun format de date n'est déclaré/);
  });

  it("sans format déclaré, l'ISO est accepté, avec ou sans heure", () => {
    expect(lire("2026-10-25").lignes[0].valeurs.date).toBe("2026-10-25");
    expect(lire("2026-10-25 14:03:11").lignes[0].valeurs.date).toBe("2026-10-25");
    expect(lire("2026-10-25T14:03:11Z").lignes[0].valeurs.date).toBe("2026-10-25");
  });

  it("accepte une heure après une date jour/mois", () => {
    expect(lire("25/10/2026 14:03", "JJ/MM/AAAA").lignes[0].valeurs.date).toBe("2026-10-25");
  });

  it("refuse une date qui n'existe pas, un format qui ne correspond pas, une année absurde", () => {
    expect(lire("31/02/2026", "JJ/MM/AAAA").anomalies[0].motif).toMatch(/inexistante/);
    expect(lire("2026-10-25", "JJ/MM/AAAA").anomalies[0].motif).toMatch(/non conforme au format JJ\/MM\/AAAA/);
    expect(lire("25/10/1850", "JJ/MM/AAAA").anomalies[0].motif).toMatch(/inexistante/);
  });

  it("une cellule date d'un classeur donne le jour affiché, sans décalage", () => {
    const r = lireTableurSelonFormat(xlsx([["Date"], [{ jour: [2026, 12, 31] }], [{ jour: [2026, 1, 1] }]]), format([c("Date", "date", "date")]));
    expect(r.lignes.map((l) => l.valeurs.date)).toEqual(["2026-12-31", "2026-01-01"]);
  });

  it("un nombre dans une colonne date (cellule non formatée) est une anomalie", () => {
    const r = lireTableurSelonFormat(xlsx([["Date"], [46320]]), format([c("Date", "date", "date")]));
    expect(r.anomalies[0].motif).toMatch(/nombre au lieu d'une date/);
  });
});

// ---------- Montants ----------

describe("montants signés", () => {
  const lire = (valeur: string) => {
    const r = lireTableurSelonFormat(csv(`Montant\n"${valeur}"\n`), format([c("Montant", "montant", "montant")]));
    return r.lignes[0].valeurs.montant;
  };

  it.each([
    ["1 500 000,50", "1500000.50"],
    ["1.500.000", "1500000.00"],
    ["1.500", "1500.00"],
    ["0,5", "0.50"],
    ["-250", "-250.00"],
    ["−250", "-250.00"],
    ["250-", "-250.00"],
    ["(250)", "-250.00"],
    ["+250", "250.00"],
    ["12 345 FCFA", "12345.00"],
    ["-0", "0.00"],
    ["-1 398,60", "-1398.60"],
  ])("« %s » vaut %s", (saisie, attendu) => {
    expect(lire(saisie)).toBe(attendu);
  });

  it("une valeur non numérique ou ambiguë est une anomalie, jamais une valeur devinée", () => {
    for (const saisie of ["abc", "1,500", "12 34"]) {
      const r = lireTableurSelonFormat(csv(`Montant\n"${saisie}"\n`), format([c("Montant", "montant", "montant")]));
      expect(r.lignes[0].valeurs.montant, saisie).toBeNull();
      expect(r.nbAnomalies, saisie).toBe(1);
    }
  });

  it("une cellule numérique garde ses centimes exacts malgré le flottant (1398.6 → 1398.60)", () => {
    const r = lireTableurSelonFormat(xlsx([["Montant"], [1398.6], [-0.1], [0.1 + 0.2]]), format([c("Montant", "montant", "montant")]));
    expect(r.lignes.map((l) => l.valeurs.montant)).toEqual(["1398.60", "-0.10", "0.30"]);
  });

  it("refuse plus de deux décimales et un montant démesuré", () => {
    const r = lireTableurSelonFormat(xlsx([["Montant"], [12.345], [1e15]]), format([c("Montant", "montant", "montant")]));
    expect(r.lignes.map((l) => l.valeurs.montant)).toEqual([null, null]);
    expect(r.anomalies.map((a) => a.motif)).toEqual(["montant avec plus de deux décimales", "montant trop élevé"]);
  });
});

// ---------- Texte, CSV, encodage ----------

describe("fichiers texte", () => {
  const FORMAT_TEXTE = format([c("Libellé", "libelle"), c("Montant", "montant", "montant")]);

  it("décode l'UTF-8 sans produire de « CafÃ© »", () => {
    expect(lireTableurSelonFormat(csv("Libellé;Montant\nCafé été;5\n"), FORMAT_TEXTE).lignes[0].valeurs.libelle).toBe("Café été");
  });

  it("retombe sur Windows-1252 pour un export d'ancien logiciel", () => {
    expect(lireTableurSelonFormat(csv("Libellé;Montant\nCafé été;5\n", "latin1"), FORMAT_TEXTE).lignes[0].valeurs.libelle).toBe("Café été");
  });

  it("ignore la marque d'ordre des octets (BOM) en tête de fichier", () => {
    const avecBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), csv("Libellé;Montant\nA;1\n")]);
    expect(lireTableurSelonFormat(avecBom, FORMAT_TEXTE).lignes[0].valeurs).toEqual({ libelle: "A", montant: "1.00" });
  });

  it("lit un champ entre guillemets qui contient le séparateur", () => {
    expect(lireTableurSelonFormat(csv('Libellé;Montant\n"a;b";1\n'), FORMAT_TEXTE).lignes[0].valeurs.libelle).toBe("a;b");
  });

  it("un nombre dans une colonne texte reste lisible (pas de notation scientifique)", () => {
    const r = lireTableurSelonFormat(xlsx([["Libellé"], [7123456789], [12.5]]), format([c("Libellé", "libelle")]));
    expect(r.lignes.map((l) => l.valeurs.libelle)).toEqual(["7123456789", "12.5"]);
  });
});

// ---------- Limites et erreurs structurelles ----------

describe("erreurs structurelles et limites", () => {
  const F = format([c("A", "a")]);

  it("refuse un fichier vide, binaire ou corrompu", () => {
    expect(() => lireTableurSelonFormat(Buffer.alloc(0), F)).toThrow(/Fichier vide/);
    expect(() => lireTableurSelonFormat(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00]), F)).toThrow(/non reconnu/);
    expect(() => lireTableurSelonFormat(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("corrompu")]), F)).toThrow(CptImportLectureError);
  });

  it("refuse un fichier plus gros que la limite en octets", () => {
    expect(() => lireTableurSelonFormat(csv("A\n1\n"), F, { tailleMaxOctets: 3 })).toThrow(/trop volumineux : \d+ octets \(maximum 3\)/);
  });

  it("accepte exactement la limite de lignes et refuse une ligne de plus", () => {
    const lignes = (n: number) => ["A", ...Array.from({ length: n }, (_, i) => String(i + 1))].join("\n");
    expect(lireTableurSelonFormat(csv(lignes(5)), F, { lignesMax: 5 }).lignes).toHaveLength(5);
    expect(() => lireTableurSelonFormat(csv(lignes(6)), F, { lignesMax: 5 })).toThrow(/plus de 5 lignes/);
  });

  it("des lignes vides en fin de fichier ne comptent pas dans la limite", () => {
    const texte = `A\n1\n2\n${";\n".repeat(20)}`;
    expect(lireTableurSelonFormat(csv(texte), F, { lignesMax: 2 }).lignes).toHaveLength(2);
  });

  it("limite le détail des anomalies mais en garde le total exact", () => {
    const n = CPT_IMPORT_ANOMALIES_DETAILLEES_MAX + 200;
    const texte = ["Montant", ...Array.from({ length: n }, () => "abc")].join("\n");
    const r = lireTableurSelonFormat(csv(texte), format([c("Montant", "montant", "montant")]));
    expect(r.nbAnomalies).toBe(n);
    expect(r.anomalies).toHaveLength(CPT_IMPORT_ANOMALIES_DETAILLEES_MAX);
  });
});

// ---------- Volume ----------

describe("volume", () => {
  it("lit 50 000 lignes de classeur en quelques secondes", () => {
    const n = 50_000;
    const lignes: Cel[][] = [["Date", "Libellé", "Montant"]];
    for (let i = 0; i < n; i++) lignes.push([{ jour: [2026, (i % 12) + 1, (i % 28) + 1] }, `Encaissement ${i}`, (i % 1000) * 100 + 0.5]);
    const fichier = xlsx(lignes);

    const debut = performance.now();
    const r = lireTableurSelonFormat(fichier, FORMAT_RELEVE);
    const ms = performance.now() - debut;

    expect(r.lignes).toHaveLength(n);
    expect(r.nbAnomalies).toBe(0);
    expect(r.lignes[n - 1].numeroLigne).toBe(n + 1);
    expect(ms).toBeLessThan(30_000);
  }, 120_000);
});

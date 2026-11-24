import { describe, expect, it } from "vitest";

import {
  apercuTableurCpt,
  construireDefinitionProduction,
  devinerFormatDate,
  formeSuggestion,
  proposerFormatProduction,
  type ChoixColonneProduction,
} from "./cptFormatApercu";
import { CptImportLectureError } from "./cptImportLecture";
import { CHAMPS_PRODUCTION_CPT, formatProductionParDefautCpt } from "./cptProduction";

const csv = (lignes: string[][]) => Buffer.from(lignes.map((l) => l.map((c) => `"${c}"`).join(",")).join("\n"), "utf8");

describe("forme de suggestion", () => {
  it("sans accents, minuscules, ponctuation et espaces réduits", () => {
    expect(formeSuggestion("  N° Police ")).toBe("n police");
    expect(formeSuggestion("Date d'échéance")).toBe("date d echeance");
    expect(formeSuggestion("PRIME   T.T.C")).toBe("prime t t c");
    expect(formeSuggestion(null)).toBe("");
  });
});

describe("ordre d'une date écrite en texte", () => {
  it("ISO et dates dont un jour dépasse 12 : une seule lecture possible", () => {
    expect(devinerFormatDate(["2026-10-25", "2026-01-03"])).toBe("AAAA-MM-JJ");
    expect(devinerFormatDate(["25/10/2026", "03/04/2026"])).toBe("JJ/MM/AAAA");
    expect(devinerFormatDate(["10/25/2026", "03/04/2026"])).toBe("MM/JJ/AAAA");
    expect(devinerFormatDate(["25-10-2026"])).toBe("JJ-MM-AAAA");
    expect(devinerFormatDate(["2026-10-25 14:03:11"])).toBe("AAAA-MM-JJ");
  });

  it("ambigu, vide ou illisible : jamais deviné", () => {
    expect(devinerFormatDate(["03/04/2026", "05/06/2026"])).toBeNull();
    expect(devinerFormatDate([])).toBeNull();
    expect(devinerFormatDate(["", "  "])).toBeNull();
    expect(devinerFormatDate(["31/02/2026"])).toBeNull();
    expect(devinerFormatDate(["demain"])).toBeNull();
  });
});

describe("proposition d'association", () => {
  it("les en-têtes du format standard retrouvent leurs 21 champs", () => {
    const entetes = CHAMPS_PRODUCTION_CPT.map((c) => c.libelle);
    const r = proposerFormatProduction(entetes, []);
    expect(r.colonnes.map((c) => c.champ)).toEqual(CHAMPS_PRODUCTION_CPT.map((c) => c.champ));
    expect(r.champsObligatoiresManquants).toEqual([]);
  });

  it("variantes d'écriture : accents, majuscules, ponctuation, synonymes", () => {
    const r = proposerFormatProduction(["N° POLICE", "Date d'echeance", "Apporteur", "TTC", "Colonne inconnue", ""], []);
    expect(r.colonnes.map((c) => [c.entete, c.champ])).toEqual([
      ["N° POLICE", "numPolice"],
      ["Date d'echeance", "dateEcheance"],
      ["Apporteur", "partenaire"],
      ["TTC", "primeTtc"],
      ["Colonne inconnue", null],
    ]);
  });

  it("un champ n'est proposé qu'une fois : la première colonne l'emporte", () => {
    const r = proposerFormatProduction(["Police", "N° de police", "Client"], []);
    expect(r.colonnes.map((c) => c.champ)).toEqual(["numPolice", null, "client"]);
  });

  it("liste les champs obligatoires sans colonne", () => {
    const r = proposerFormatProduction(["Police", "Client"], []);
    expect(r.champsObligatoiresManquants).toEqual(["Produit (code ou libellé)", "Date d'effet", "Date d'échéance", "Prime TTC"]);
  });

  it("propose l'ordre d'une colonne date seulement s'il est sans ambiguïté", () => {
    const r = proposerFormatProduction(
      ["Date d'effet", "Date d'échéance", "Client"],
      [
        ["25/10/2026", "03/04/2027", "A"],
        ["01/11/2026", "05/06/2027", "B"],
      ]
    );
    expect(r.colonnes[0].formatDate).toBe("JJ/MM/AAAA");
    expect(r.colonnes[1].formatDate).toBeNull();
    expect(r.colonnes[2].formatDate).toBeNull();
    expect(r.colonnes[0].echantillon).toEqual(["25/10/2026", "01/11/2026"]);
  });
});

describe("définition finale", () => {
  const choixComplet = (): ChoixColonneProduction[] =>
    CHAMPS_PRODUCTION_CPT.map((c) => ({ entete: c.libelle, champ: c.champ, formatDate: c.type === "date" ? "JJ/MM/AAAA" : null }));

  it("un choix complet donne exactement le format standard", () => {
    const r = construireDefinitionProduction(1, choixComplet());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.definition).toEqual(formatProductionParDefautCpt());
  });

  it("une colonne ignorée n'entre pas dans le format ; le type vient du bordereau, jamais de l'écran", () => {
    const choix: ChoixColonneProduction[] = [...choixComplet(), { entete: "Observations", champ: null }, { entete: "Vide", champ: "" }];
    const r = construireDefinitionProduction(2, choix);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.definition.ligneEntete).toBe(2);
      expect(r.definition.colonnes).toHaveLength(21);
      expect(r.definition.colonnes.find((c) => c.champ === "primeTtc")).toMatchObject({ type: "montant", obligatoire: true });
    }
  });

  it("toutes les erreurs d'un coup : champ obligatoire absent, champ en double, date sans ordre, champ inconnu", () => {
    const r = construireDefinitionProduction(1, [
      { entete: "Police", champ: "numPolice" },
      { entete: "N° de police", champ: "numPolice" },
      { entete: "Effet", champ: "dateEffet", formatDate: null },
      { entete: "Divers", champ: "nExistePas" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const texte = r.erreurs.join(" | ");
      expect(texte).toContain("associé à deux colonnes");
      expect(texte).toContain("choisissez l'ordre de la date");
      expect(texte).toContain("champ inconnu");
      expect(texte).toContain("« Prime TTC » est obligatoire");
      expect(texte).toContain("« Produit (code ou libellé) » est obligatoire");
    }
  });

  it("deux en-têtes qui se confondent sont refusés par la validation du format", () => {
    const choix = choixComplet().map((c) => (c.champ === "client" ? { ...c, entete: "Numéro de police" } : c));
    const r = construireDefinitionProduction(1, choix);
    expect(r.ok).toBe(false);
  });
});

describe("aperçu d'un fichier", () => {
  it("lit les en-têtes et les premières lignes non vides", () => {
    const fichier = csv([["Police", "Client", "Prime TTC"], ["POL-1", "Awa", "1000"], ["", "", ""], ["POL-2", "Yao", "2000"], ["POL-3", "Bamba", "3000"]]);
    const r = apercuTableurCpt(fichier, 1, 2);
    expect(r.type).toBe("csv");
    expect(r.enTetes).toEqual(["Police", "Client", "Prime TTC"]);
    expect(r.echantillon).toEqual([["POL-1", "Awa", "1000"], ["POL-2", "Yao", "2000"]]);
  });

  it("en-têtes à une autre ligne que la première", () => {
    const fichier = csv([["Bordereau de septembre", "", ""], ["Police", "Client", "Prime TTC"], ["POL-1", "Awa", "1000"]]);
    const r = apercuTableurCpt(fichier, 2);
    expect(r.enTetes).toEqual(["Police", "Client", "Prime TTC"]);
    expect(r.echantillon).toEqual([["POL-1", "Awa", "1000"]]);
  });

  it("refuse un fichier vide, une ligne d'en-têtes hors limites ou sans contenu", () => {
    expect(() => apercuTableurCpt(Buffer.alloc(0), 1)).toThrow(CptImportLectureError);
    const fichier = csv([["Police", "Client"], ["POL-1", "Awa"]]);
    expect(() => apercuTableurCpt(fichier, 0)).toThrow(CptImportLectureError);
    expect(() => apercuTableurCpt(fichier, 51)).toThrow(CptImportLectureError);
    expect(() => apercuTableurCpt(fichier, 10)).toThrow(CptImportLectureError);
  });
});

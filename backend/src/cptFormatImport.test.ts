import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  COLONNES_FORMAT_MAX,
  LIBELLE_TYPE_IMPORT_CPT,
  TYPES_IMPORT_CPT,
  validerDefinitionFormat,
} from "./cptFormatImport";

const col = (entete: string, champ: string, extra: Record<string, unknown> = {}) => ({ entete, champ, type: "texte", ...extra });

function erreurs(entree: { ligneEntete?: unknown; colonnes?: unknown }): string[] {
  const r = validerDefinitionFormat(entree);
  if (r.ok) throw new Error("Une erreur était attendue.");
  return r.erreurs;
}

describe("validerDefinitionFormat : définition valide", () => {
  it("normalise : ligne d'en-têtes 1 et colonne facultative par défaut, entête rogné", () => {
    const r = validerDefinitionFormat({
      colonnes: [
        { entete: "  Date  ", champ: "date", type: "date", formatDate: "JJ/MM/AAAA", obligatoire: true },
        { entete: "Montant", champ: "montant", type: "montant" },
      ],
    });
    expect(r).toEqual({
      ok: true,
      definition: {
        ligneEntete: 1,
        colonnes: [
          { entete: "Date", champ: "date", type: "date", obligatoire: true, formatDate: "JJ/MM/AAAA" },
          { entete: "Montant", champ: "montant", type: "montant", obligatoire: false },
        ],
      },
    });
  });

  it("accepte une ligne d'en-têtes de 1 à 50", () => {
    for (const ligneEntete of [1, 7, 50]) expect(validerDefinitionFormat({ ligneEntete, colonnes: [col("A", "a")] }).ok).toBe(true);
  });

  it("une date sans format déclaré est permise (seul l'ISO sera alors accepté à la lecture)", () => {
    expect(validerDefinitionFormat({ colonnes: [{ entete: "Date", champ: "date", type: "date" }] }).ok).toBe(true);
  });
});

describe("validerDefinitionFormat : refus, toutes les erreurs d'un coup", () => {
  it("refuse une liste vide, absente ou trop longue", () => {
    expect(erreurs({ colonnes: [] })[0]).toMatch(/au moins une colonne/);
    expect(erreurs({})[0]).toMatch(/au moins une colonne/);
    expect(erreurs({ colonnes: Array.from({ length: COLONNES_FORMAT_MAX + 1 }, (_, i) => col(`E${i}`, `c${i}`)) })[0]).toMatch(/au plus 100/);
  });

  it("refuse une ligne d'en-têtes hors de 1 à 50 ou non entière", () => {
    for (const ligneEntete of [0, 51, 1.5, "2", -1]) {
      expect(erreurs({ ligneEntete, colonnes: [col("A", "a")] }).join(" ")).toMatch(/ligne des en-têtes/);
    }
  });

  it("signale ensemble tous les défauts de plusieurs colonnes", () => {
    const e = erreurs({
      colonnes: [
        { entete: "", champ: "Mauvais Champ", type: "nombre" },
        { entete: "Ok", champ: "ok", type: "texte", obligatoir: true },
        { entete: "Date", champ: "date", type: "date", formatDate: "MM-JJ-AAAA" },
        { entete: "Texte", champ: "texte", type: "texte", formatDate: "JJ/MM/AAAA" },
        "pas un objet",
      ],
    });
    const texte = e.join("\n");
    expect(texte).toMatch(/Colonne 1 : l'en-tête du fichier est obligatoire/);
    expect(texte).toMatch(/Colonne 1 : le champ interne/);
    expect(texte).toMatch(/Colonne 1 : le type doit être/);
    expect(texte).toMatch(/Colonne 2 : propriété inconnue « obligatoir »/);
    expect(texte).toMatch(/Colonne 3 : format de date inconnu/);
    expect(texte).toMatch(/Colonne 4 : un format de date n'a de sens que pour/);
    expect(texte).toMatch(/Colonne 5 : description invalide/);
  });

  it("refuse « obligatoire » qui n'est pas un booléen", () => {
    expect(erreurs({ colonnes: [col("A", "a", { obligatoire: "oui" })] }).join(" ")).toMatch(/vrai ou faux/);
  });

  it("refuse deux colonnes qui alimentent le même champ", () => {
    expect(erreurs({ colonnes: [col("A", "montant"), col("B", "montant")] }).join(" ")).toMatch(/« montant » est déjà alimenté par la colonne 1/);
  });

  it("refuse deux en-têtes qui se confondent (même casse et espaces mis à part)", () => {
    expect(erreurs({ colonnes: [col("Montant", "a"), col("  MONTANT ", "b")] }).join(" ")).toMatch(/se confond avec celui de la colonne 1/);
  });

  it("refuse un nom de champ qui ne commence pas par une minuscule ou contient des accents ou des espaces", () => {
    for (const champ of ["Montant", "1montant", "mon montant", "montant_ttc", "montànt", ""]) {
      expect(erreurs({ colonnes: [col("A", champ)] }).join(" "), champ).toMatch(/champ interne/);
    }
  });
});

describe("types d'import : synchronisés avec l'enum Prisma", () => {
  it("TYPES_IMPORT_CPT = valeurs de l'enum CptTypeImport, chacune avec un libellé", () => {
    const schema = readFileSync(fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url)), "utf8");
    const bloc = /enum CptTypeImport \{([^}]*)\}/.exec(schema)?.[1] ?? "";
    const valeurs = [...bloc.matchAll(/^\s*([A-Z_]+)\s*$/gm)].map((m) => m[1]);
    expect([...valeurs].sort()).toEqual([...TYPES_IMPORT_CPT].sort());
    expect(Object.keys(LIBELLE_TYPE_IMPORT_CPT).sort()).toEqual([...TYPES_IMPORT_CPT].sort());
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { validerDefinitionFormat } from "./cptFormatImport";
import { CHAMPS_PRODUCTION_CPT, formatProductionParDefautCpt, NOM_FORMAT_PRODUCTION_DEFAUT_CPT } from "./cptProduction";

const MIGRATION = path.resolve(__dirname, "../prisma/migrations/20261101170000_compta_format_production_defaut/migration.sql");

function colonnesDeLaMigration(): unknown {
  const sql = readFileSync(MIGRATION, "utf8");
  const m = /\$json\$([\s\S]*?)\$json\$/.exec(sql);
  if (!m) throw new Error("JSON introuvable dans la migration.");
  return JSON.parse(m[1]);
}

describe("format d'import PRODUCTION par défaut", () => {
  it("la migration recopie exactement le format du code (même JSON, même ordre)", () => {
    expect(colonnesDeLaMigration()).toEqual(formatProductionParDefautCpt().colonnes);
  });

  it("le nom posé par la migration est celui du code", () => {
    expect(readFileSync(MIGRATION, "utf8")).toContain(`'${NOM_FORMAT_PRODUCTION_DEFAUT_CPT}'`);
  });

  it("le format est valide : un champ interne par colonne, aucun en-tête en double", () => {
    const r = validerDefinitionFormat(formatProductionParDefautCpt());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.definition.colonnes.map((c) => c.champ)).toEqual(CHAMPS_PRODUCTION_CPT.map((c) => c.champ));
  });

  it("les colonnes obligatoires sont celles du bordereau : police, produit, deux dates, prime TTC", () => {
    const obligatoires = formatProductionParDefautCpt()
      .colonnes.filter((c) => c.obligatoire)
      .map((c) => c.champ);
    expect(obligatoires).toEqual(["numPolice", "produit", "dateEffet", "dateEcheance", "primeTtc"]);
  });

  it("seules les colonnes de type date portent un format de date", () => {
    for (const c of formatProductionParDefautCpt().colonnes) {
      expect(c.formatDate !== undefined).toBe(c.type === "date");
    }
  });
});

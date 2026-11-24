import { describe, expect, it } from "vitest";

import {
  cleSequenceAnnuelle,
  CptSequenceError,
  formaterNumero,
  prochaineValeur,
  prochainNumero,
  remonterSequence,
} from "./cptSequence";

/** Faux client dont `$queryRaw` (gabarit étiqueté) enregistre le SQL et renvoie une valeur fixée. */
function fauxClient(valeur: number) {
  const sql: string[] = [];
  const parametres: unknown[][] = [];
  const db = {
    $queryRaw: (chaines: TemplateStringsArray, ...valeurs: unknown[]) => {
      sql.push(chaines.join("?"));
      parametres.push(valeurs);
      return Promise.resolve([{ valeur: valeur }]);
    },
  } as never;
  return { db, sql, parametres };
}

describe("Séquences Gestion Compta — clés et formats (C-11)", () => {
  it("CPE-AAAA-NNNNNN et CPR-AAAA-NNNNNN sur 6 chiffres, CPD-AAAA-NN sur 2 chiffres", () => {
    expect(formaterNumero(cleSequenceAnnuelle("CPE", 2026), 123)).toBe("CPE-2026-000123");
    expect(formaterNumero(cleSequenceAnnuelle("CPE", 2026), 1)).toBe("CPE-2026-000001");
    expect(formaterNumero(cleSequenceAnnuelle("CPR", 2027), 42)).toBe("CPR-2027-000042");
    expect(formaterNumero(cleSequenceAnnuelle("CPD", 2026), 9)).toBe("CPD-2026-09");
  });

  it("n'utilise jamais les préfixes d'Encaissements (PAI, SUS, RGS, BRD)", () => {
    for (const cle of ["PAI-2026", "SUS-2026", "RGS-2026", "BRD-2026-09"]) {
      expect(() => formaterNumero(cle, 1), cle).toThrow(/Clé de séquence invalide/);
    }
  });

  it("refuse une année, une clé ou une valeur invalides, et une séquence épuisée", () => {
    expect(() => cleSequenceAnnuelle("CPE", 26)).toThrow(CptSequenceError);
    expect(() => cleSequenceAnnuelle("CPE", 3000)).toThrow(CptSequenceError);
    expect(() => formaterNumero("DEM-2026", 1)).toThrow(/Clé de séquence invalide/);
    expect(() => formaterNumero("CPE-2026", 0)).toThrow(CptSequenceError);
    expect(() => formaterNumero("CPE-2026", 1.5)).toThrow(CptSequenceError);
    expect(() => formaterNumero("CPE-2026", 1000000)).toThrow(/épuisée/);
    expect(() => formaterNumero("CPD-2026", 100)).toThrow(/épuisée/);
  });
});

describe("Séquences Gestion Compta — accès base", () => {
  it("n'envoie aucune requête pour une clé invalide", async () => {
    const { db, sql } = fauxClient(1);
    await expect(prochaineValeur(db, "CPE-26")).rejects.toThrow(CptSequenceError);
    await expect(remonterSequence(db, "PAI-2026", 5)).rejects.toThrow(CptSequenceError);
    expect(sql).toHaveLength(0);
  });

  it("incrémente en UNE requête atomique (ON CONFLICT … RETURNING) sur CptSequence, jamais EncSequence", async () => {
    const { db, sql, parametres } = fauxClient(7);
    expect(await prochaineValeur(db, "CPE-2026")).toBe(7);
    expect(sql).toHaveLength(1);
    expect(sql[0]).toContain('"CptSequence"');
    expect(sql[0]).toContain("ON CONFLICT");
    expect(sql[0]).toContain("RETURNING");
    expect(sql[0]).not.toContain("EncSequence");
    expect(parametres[0]).toEqual(["CPE-2026"]);
  });

  it("formate le numéro suivant à partir de la valeur renvoyée par la base", async () => {
    const { db } = fauxClient(124);
    expect(await prochainNumero(db, "CPE-2026")).toBe("CPE-2026-000124");
  });

  it("la reprise ne fait jamais baisser une séquence (GREATEST) et refuse une valeur négative", async () => {
    const { db, sql, parametres } = fauxClient(900);
    expect(await remonterSequence(db, "CPE-2026", 900)).toBe(900);
    expect(sql[0]).toContain("GREATEST");
    expect(sql[0]).toContain('"CptSequence"');
    expect(parametres[0]).toEqual(["CPE-2026", 900]);
    await expect(remonterSequence(db, "CPE-2026", -1)).rejects.toThrow(CptSequenceError);
  });
});

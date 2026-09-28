import { describe, expect, it } from "vitest";

import { cleSequenceAnnuelle, cleSequenceBordereau, EncSequenceError, formaterNumero, prochaineValeur } from "./encSequence";

describe("Séquences Encaissements — clés et formats du cahier", () => {
  it("PAI-AAAA-NNNNNN et SUS-AAAA-NNNNNN (cahier §3.2 PaiementID, F10.1)", () => {
    expect(formaterNumero(cleSequenceAnnuelle("PAI", 2026), 123)).toBe("PAI-2026-000123");
    expect(formaterNumero(cleSequenceAnnuelle("SUS", 2026), 1)).toBe("SUS-2026-000001");
    expect(formaterNumero(cleSequenceAnnuelle("RGS", 2027), 42)).toBe("RGS-2027-000042");
  });

  it("BRD-AAAA-MM-NNNN, repartant à 1 chaque mois (F5.1)", () => {
    expect(cleSequenceBordereau(2026, 9)).toBe("BRD-2026-09");
    expect(formaterNumero(cleSequenceBordereau(2026, 9), 7)).toBe("BRD-2026-09-0007");
  });

  it("refuse une clé, une année, un mois ou une valeur invalides, et une séquence épuisée", () => {
    expect(() => cleSequenceBordereau(2026, 13)).toThrow(EncSequenceError);
    expect(() => cleSequenceAnnuelle("PAI", 26)).toThrow(EncSequenceError);
    expect(() => formaterNumero("DEM-2026", 1)).toThrow(/Clé de séquence invalide/);
    expect(() => formaterNumero("PAI-2026", 0)).toThrow(EncSequenceError);
    expect(() => formaterNumero("BRD-2026-09", 10000)).toThrow(/épuisée/);
  });

  it("n'envoie aucune requête pour une clé invalide", async () => {
    let appels = 0;
    const db = { $queryRaw: () => { appels++; return Promise.resolve([]); } } as never;
    await expect(prochaineValeur(db, "PAI-26")).rejects.toThrow(EncSequenceError);
    expect(appels).toBe(0);
  });
});

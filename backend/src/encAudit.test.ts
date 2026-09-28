import { describe, expect, it } from "vitest";

import { EncDecimal } from "./encCalcul";
import { EncAuditError, preparerAudit, premierDuMois, versJsonAudit } from "./encAudit";

describe("Audit Encaissements — préparation d'une ligne", () => {
  it("sérialise montants, dates et BigInt en JSON stockable", () => {
    const json = versJsonAudit({ montant: new EncDecimal("55944.06"), le: new Date("2026-09-12T10:00:00Z"), n: BigInt(7) });
    expect(json).toEqual({ montant: "55944.06", le: "2026-09-12T10:00:00.000Z", n: "7" });
    expect(versJsonAudit(undefined)).toBeUndefined();
    expect(versJsonAudit(null)).toBeUndefined();
  });

  it("ramène le mois de rattachement au 1er du mois (UTC)", () => {
    expect(premierDuMois(new Date("2026-09-27T23:30:00Z")).toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(() => premierDuMois(new Date("invalide"))).toThrow(EncAuditError);
  });

  it("exige entité, identifiant, action et auteur ; un motif vide devient null", () => {
    const ligne = preparerAudit({ entite: " EncContrat ", entiteId: "c1", action: "creation", userId: "u1", motif: "  " });
    expect(ligne).toMatchObject({ entite: "EncContrat", entiteId: "c1", action: "creation", motif: null, mois: null, ip: null });
    expect(() => preparerAudit({ entite: "", entiteId: "c1", action: "creation", userId: "u1" })).toThrow(EncAuditError);
    expect(() => preparerAudit({ entite: "EncContrat", entiteId: "c1", action: "creation", userId: "" })).toThrow(/auteur/);
  });
});

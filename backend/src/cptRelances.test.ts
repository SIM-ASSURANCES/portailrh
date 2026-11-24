import { describe, expect, it } from "vitest";

import { evaluerPromesseCpt, relanceProposeeAvecPromessesCpt, validerPromesseCpt, validerRelanceCpt } from "./cptRelances";

const AUJ = "2026-11-24";
const c = (n: number) => BigInt(n);

describe("validerRelanceCpt", () => {
  it("accepte un canal connu, une date passée ou du jour, un commentaire facultatif", () => {
    const r = validerRelanceCpt({ canal: "SMS", faiteLe: AUJ, commentaire: "  Rappelé   ce matin " }, AUJ);
    expect(r).toEqual({ ok: true, valeur: { canal: "SMS", faiteLe: AUJ, commentaire: "Rappelé ce matin" } });
    expect(validerRelanceCpt({ canal: "VISITE", faiteLe: "2026-11-01", commentaire: "" }, AUJ)).toMatchObject({ ok: true, valeur: { commentaire: null } });
  });
  it("refuse un canal inconnu, une date future ou invalide, un commentaire trop long", () => {
    const r = validerRelanceCpt({ canal: "PIGEON", faiteLe: "2026-12-01", commentaire: "x".repeat(501) }, AUJ);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erreurs).sort()).toEqual(["canal", "commentaire", "faiteLe"]);
    expect(validerRelanceCpt({ canal: "EMAIL", faiteLe: "2026-02-31", commentaire: "" }, AUJ).ok).toBe(false);
  });
});

describe("validerPromesseCpt", () => {
  it("accepte un montant au plus égal au reste dû et une date du jour ou future", () => {
    expect(validerPromesseCpt({ montant: "100 000", datePromise: "2026-12-05" }, AUJ, c(35_000_000))).toEqual({ ok: true, valeur: { montant: c(10_000_000), datePromise: "2026-12-05" } });
    expect(validerPromesseCpt({ montant: 500, datePromise: AUJ }, AUJ, c(50_000)).ok).toBe(true);
  });
  it("refuse zéro, un montant au-delà du reste dû, une date passée", () => {
    expect(validerPromesseCpt({ montant: "0", datePromise: AUJ }, AUJ, c(50_000)).ok).toBe(false);
    const r = validerPromesseCpt({ montant: "501", datePromise: "2026-11-23" }, AUJ, c(50_000));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erreurs).sort()).toEqual(["datePromise", "montant"]);
  });
});

describe("evaluerPromesseCpt (C-21)", () => {
  const base = { montant: c(10_000_000), datePromise: "2026-12-05" };
  it("tenue dès que l'encaissé prouvé atteint le montant, même avant la date", () => {
    expect(evaluerPromesseCpt({ ...base, prouve: c(10_000_000) }, "2026-11-30")).toBe("TENUE");
    expect(evaluerPromesseCpt({ ...base, prouve: c(12_000_000) }, "2026-12-20")).toBe("TENUE");
  });
  it("en cours jusqu'à la date promise incluse", () => {
    expect(evaluerPromesseCpt({ ...base, prouve: c(9_999_999) }, "2026-12-05")).toBe("EN_COURS");
  });
  it("non tenue le lendemain de la date promise si le montant n'est pas atteint", () => {
    expect(evaluerPromesseCpt({ ...base, prouve: c(0) }, "2026-12-06")).toBe("NON_TENUE");
  });
});

describe("relance proposée", () => {
  it("proposée s'il y a un retard et aucune promesse en cours", () => {
    expect(relanceProposeeAvecPromessesCpt({ nbEcheancesEnRetard: 2, nbPromessesEnCours: 0 })).toBe(true);
    expect(relanceProposeeAvecPromessesCpt({ nbEcheancesEnRetard: 2, nbPromessesEnCours: 1 })).toBe(false);
    expect(relanceProposeeAvecPromessesCpt({ nbEcheancesEnRetard: 0, nbPromessesEnCours: 0 })).toBe(false);
  });
});

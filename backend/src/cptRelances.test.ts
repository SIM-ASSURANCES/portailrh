import { describe, expect, it } from "vitest";

import { etatAffichePromesseCpt, prouvePourPromesseCpt, relanceProposeeAvecPromessesCpt, validerPromesseCpt, validerRelanceCpt } from "./cptRelances";

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

describe("etatAffichePromesseCpt (C-21)", () => {
  const base = { montant: c(10_000_000), datePromise: "2026-12-05" };
  it("tenue dès que l'encaissé prouvé atteint le montant, même avant la date", () => {
    expect(etatAffichePromesseCpt({ ...base, prouve: c(10_000_000) }, "2026-11-30")).toBe("TENUE");
    expect(etatAffichePromesseCpt({ ...base, prouve: c(12_000_000) }, "2026-12-20")).toBe("TENUE");
  });
  it("en cours jusqu'à la date promise incluse", () => {
    expect(etatAffichePromesseCpt({ ...base, prouve: c(9_999_999) }, "2026-12-05")).toBe("EN_COURS");
  });
  it("non tenue le lendemain de la date promise si le montant n'est pas atteint", () => {
    expect(etatAffichePromesseCpt({ ...base, prouve: c(0) }, "2026-12-06")).toBe("NON_TENUE");
  });
});

describe("relance proposée", () => {
  it("proposée s'il y a un retard et aucune promesse en cours", () => {
    expect(relanceProposeeAvecPromessesCpt({ nbEcheancesEnRetard: 2, nbPromessesEnCours: 0 })).toBe(true);
    expect(relanceProposeeAvecPromessesCpt({ nbEcheancesEnRetard: 2, nbPromessesEnCours: 1 })).toBe(false);
    expect(relanceProposeeAvecPromessesCpt({ nbEcheancesEnRetard: 0, nbPromessesEnCours: 0 })).toBe(false);
  });
});

describe("état affiché d'une promesse : fenêtre de preuve et cas limites (C-21)", () => {
  const promesse = { creeLe: "2026-11-10", datePromise: "2026-12-05" };
  const montant = c(10_000_000); // 100 000 FCFA en centimes
  const etat = (paiements: { jour: string; montant: bigint }[], aujourdhui: string) =>
    etatAffichePromesseCpt({ montant, datePromise: promesse.datePromise, prouve: prouvePourPromesseCpt(paiements, promesse) }, aujourdhui);

  it("avant la date promise sans argent : en cours ; le jour même : en cours ; le lendemain : non tenue", () => {
    expect(etat([], "2026-11-30")).toBe("EN_COURS");
    expect(etat([], "2026-12-05")).toBe("EN_COURS");
    expect(etat([], "2026-12-06")).toBe("NON_TENUE");
  });
  it("encaissé partiel : en cours avant l'échéance, non tenue après", () => {
    const partiel = [{ jour: "2026-11-20", montant: c(6_000_000) }];
    expect(etat(partiel, "2026-12-01")).toBe("EN_COURS");
    expect(etat(partiel, "2026-12-06")).toBe("NON_TENUE");
  });
  it("deux paiements qui additionnent exactement le montant (au centime) : tenue, même avant la date", () => {
    const deux = [{ jour: "2026-11-12", montant: c(6_000_000) }, { jour: "2026-11-25", montant: c(4_000_000) }];
    expect(etat(deux, "2026-11-26")).toBe("TENUE");
    expect(etat([{ jour: "2026-11-12", montant: c(9_999_999) }], "2026-12-01")).toBe("EN_COURS");
  });
  it("un paiement dont la date de valeur est APRÈS la date promise ne compte pas : la promesse reste non tenue", () => {
    expect(etat([{ jour: "2026-12-06", montant: c(10_000_000) }], "2026-12-10")).toBe("NON_TENUE");
  });
  it("un paiement antérieur à la création de la promesse ne compte pas non plus", () => {
    expect(etat([{ jour: "2026-11-09", montant: c(10_000_000) }], "2026-12-10")).toBe("NON_TENUE");
  });
  it("les bornes de la fenêtre sont incluses (jour de création et date promise)", () => {
    expect(prouvePourPromesseCpt([{ jour: "2026-11-10", montant: c(1) }, { jour: "2026-12-05", montant: c(2) }], promesse)).toBe(c(3));
  });
});

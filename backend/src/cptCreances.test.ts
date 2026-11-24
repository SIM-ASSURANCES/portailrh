import { describe, expect, it } from "vitest";

import { construireEcheancier } from "./cptEcheancier";
import { syntheseContratCreanceCpt, trancheCreanceCpt, type EcheanceCreanceCpt } from "./cptCreances";

const c = (centimes: number) => BigInt(centimes);

describe("trancheCreanceCpt (C-5)", () => {
  it("découpe 0–30, 31–90, 91–180, plus de 180 jours", () => {
    expect([0, 30, 31, 90, 91, 180, 181, 400].map(trancheCreanceCpt)).toEqual(["T0_30", "T0_30", "T31_90", "T31_90", "T91_180", "T91_180", "PLUS_180", "PLUS_180"]);
  });
});

describe("syntheseContratCreanceCpt", () => {
  it("T7 : trois échéances, la plus ancienne a 120 jours → tranche 91–180", () => {
    // Aujourd'hui 2026-11-24 : 120 jours avant = 2026-07-27.
    const echeances: EcheanceCreanceCpt[] = [
      { rang: 1, etat: "OUVERTE", datePrevue: "2026-07-27", montantDu: "100000", montantRegle: "0" },
      { rang: 2, etat: "OUVERTE", datePrevue: "2026-09-27", montantDu: "100000", montantRegle: "0" },
      { rang: 3, etat: "OUVERTE", datePrevue: "2027-01-27", montantDu: "100000", montantRegle: "0" },
    ];
    const s = syntheseContratCreanceCpt({ statut: "EN_COURS", declarePaye: false, echeances }, "2026-11-24");
    expect(s.joursAnciennete).toBe(120);
    expect(s.depuisLe).toBe("2026-07-27");
    expect(s.tranche).toBe("T91_180");
    expect(s.primeEmise).toBe(c(30_000_000));
    expect(s.resteDu).toBe(c(30_000_000));
    // La troisième échéance n'est pas échue : elle compte dans le reste dû, jamais dans la dette en retard.
    expect(s.resteEchu).toBe(c(20_000_000));
    expect(s.resteEnRetard).toBe(c(20_000_000));
    expect(s.nbEcheancesEnRetard).toBe(2);
  });

  it("T12 : 6 077 832 en 12 × 506 486, deux payées → reste dû 5 064 860, l'échéance d'août en retard", () => {
    const r = construireEcheancier({ primeTtc: "6077832", accessoires: "0", taxe: "1077832", dateEffet: "2026-06-01", dateEcheance: "2027-05-31", fractionnement: "MENSUEL" });
    if (!r.ok) throw new Error(r.erreur);
    expect(r.echeances).toHaveLength(12);
    // Échéancier mensuel depuis le 1er juin : juin et juillet payées, août (rang 3, 1er août) en retard au 24 novembre ? Non :
    // la date du jour est fixée ici au 2026-08-20 pour que le 1er août soit la plus ancienne impayée et septembre pas encore échu.
    const echeances: EcheanceCreanceCpt[] = r.echeances.map((e, i) => ({
      rang: e.rang,
      etat: i < 2 ? "SOLDEE" : "OUVERTE",
      datePrevue: e.datePrevue,
      montantDu: e.montantDu,
      montantRegle: i < 2 ? e.montantDu : "0",
    }));
    const s = syntheseContratCreanceCpt({ statut: "EN_COURS", declarePaye: false, echeances }, "2026-08-20");
    expect(s.primeEmise).toBe(c(607_783_200));
    expect(s.encaisseProuve).toBe(c(101_297_200));
    expect(s.resteDu).toBe(c(506_486_000));
    const aout = echeances[2];
    expect(aout.datePrevue).toBe("2026-08-01");
    expect(s.depuisLe).toBe("2026-08-01");
    expect(s.joursAnciennete).toBe(19);
    expect(s.tranche).toBe("T0_30");
    expect(s.resteEnRetard).toBe(BigInt(Math.round(Number(aout.montantDu) * 100)));
    expect(s.nbEcheancesEnRetard).toBe(1);
  });

  it("T12 (reste dû de l'énoncé) : 2 payées sur 12 → 10 × 506 486 = 5 064 860", () => {
    const echeances: EcheanceCreanceCpt[] = Array.from({ length: 12 }, (_, i) => ({
      rang: i + 1,
      etat: i < 2 ? "SOLDEE" : "OUVERTE",
      datePrevue: `2026-${String(i + 6 > 12 ? i + 6 - 12 : i + 6).padStart(2, "0")}-01`,
      montantDu: "506486",
      montantRegle: i < 2 ? "506486" : "0",
    }));
    const s = syntheseContratCreanceCpt({ statut: "EN_COURS", declarePaye: false, echeances }, "2026-08-20");
    expect(s.primeEmise).toBe(c(607_783_200));
    expect(s.resteDu).toBe(c(506_486_000));
  });

  it("une échéance non échue n'est pas une dette en retard : aucune ancienneté", () => {
    const s = syntheseContratCreanceCpt(
      { statut: "EN_COURS", declarePaye: false, echeances: [{ rang: 1, etat: "OUVERTE", datePrevue: "2026-12-01", montantDu: "1000", montantRegle: "0" }] },
      "2026-11-24"
    );
    expect(s.resteDu).toBe(c(100_000));
    expect(s.resteEchu).toBe(c(0));
    expect(s.depuisLe).toBeNull();
    expect(s.tranche).toBeNull();
  });

  it("une échéance qui tombe aujourd'hui est échue (ancienneté 0) mais pas en retard", () => {
    const s = syntheseContratCreanceCpt(
      { statut: "EN_COURS", declarePaye: false, echeances: [{ rang: 1, etat: "OUVERTE", datePrevue: "2026-11-24", montantDu: "1000", montantRegle: "0" }] },
      "2026-11-24"
    );
    expect(s.resteEchu).toBe(c(100_000));
    expect(s.resteEnRetard).toBe(c(0));
    expect(s.joursAnciennete).toBe(0);
    expect(s.tranche).toBe("T0_30");
  });

  it("l'ancienneté part de la date PRÉVUE de la plus ancienne impayée, pas de la date de saisie ; un paiement partiel laisse l'échéance impayée", () => {
    const s = syntheseContratCreanceCpt(
      {
        statut: "EN_COURS",
        declarePaye: false,
        echeances: [
          { rang: 1, etat: "SOLDEE", datePrevue: "2026-01-01", montantDu: "1000", montantRegle: "1000" },
          { rang: 2, etat: "OUVERTE", datePrevue: "2026-02-01", montantDu: "1000", montantRegle: "400" },
        ],
      },
      "2026-11-24"
    );
    expect(s.depuisLe).toBe("2026-02-01");
    expect(s.resteDu).toBe(c(60_000));
    expect(s.tranche).toBe("PLUS_180");
  });

  it("déclaré payé non prouvé : le reste dû d'un contrat que la production dit payé (inclus dans le reste dû, jamais en plus)", () => {
    const echeances: EcheanceCreanceCpt[] = [{ rang: 1, etat: "OUVERTE", datePrevue: "2026-10-01", montantDu: "5000", montantRegle: "0" }];
    expect(syntheseContratCreanceCpt({ statut: "EN_COURS", declarePaye: true, echeances }, "2026-11-24").declarePayeNonProuve).toBe(c(500_000));
    expect(syntheseContratCreanceCpt({ statut: "EN_COURS", declarePaye: false, echeances }, "2026-11-24").declarePayeNonProuve).toBe(c(0));
    const prouve = [{ ...echeances[0], etat: "SOLDEE" as const, montantRegle: "5000" }];
    expect(syntheseContratCreanceCpt({ statut: "EN_COURS", declarePaye: true, echeances: prouve }, "2026-11-24").declarePayeNonProuve).toBe(c(0));
  });

  it("un contrat annulé et une échéance annulée ne sont pas des dettes", () => {
    const echeances: EcheanceCreanceCpt[] = [{ rang: 1, etat: "OUVERTE", datePrevue: "2026-01-01", montantDu: "5000", montantRegle: "0" }];
    expect(syntheseContratCreanceCpt({ statut: "ANNULE", declarePaye: false, echeances }, "2026-11-24").resteDu).toBe(c(0));
    expect(syntheseContratCreanceCpt({ statut: "EN_COURS", declarePaye: false, echeances: [{ ...echeances[0], etat: "ANNULEE" }] }, "2026-11-24").resteDu).toBe(c(0));
  });
});

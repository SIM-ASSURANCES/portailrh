import { describe, expect, it } from "vitest";

import { calculerSituationContrat } from "./encSituation";

describe("calculerSituationContrat — confirmés seulement (§5.1, 2026-10-02)", () => {
  it("aucun paiement confirmé : tout reste dû", () => {
    const s = calculerSituationContrat("1500", []);
    expect([s.encaisse.toFixed(2), s.resteDu.toFixed(2), s.tropPercu.toFixed(2)]).toEqual(["0.00", "1500.00", "0.00"]);
  });

  it("paiements partiels", () => {
    const s = calculerSituationContrat("1500", ["500", "400.50"]);
    expect([s.encaisse.toFixed(2), s.resteDu.toFixed(2), s.tropPercu.toFixed(2)]).toEqual(["900.50", "599.50", "0.00"]);
  });

  it("soldé exactement", () => {
    const s = calculerSituationContrat("1500", ["1000", "500"]);
    expect([s.resteDu.toFixed(2), s.tropPercu.toFixed(2)]).toEqual(["0.00", "0.00"]);
  });

  it("trop-perçu : jamais un reste dû négatif", () => {
    const s = calculerSituationContrat("1500", ["1000", "700"]);
    expect([s.encaisse.toFixed(2), s.resteDu.toFixed(2), s.tropPercu.toFixed(2)]).toEqual(["1700.00", "0.00", "200.00"]);
  });

  it("une future contre-passation (montant confirmé négatif) entre d'elle-même dans la somme", () => {
    const s = calculerSituationContrat("1500", ["1000", "700", "-700"]);
    expect([s.encaisse.toFixed(2), s.resteDu.toFixed(2), s.tropPercu.toFixed(2)]).toEqual(["1000.00", "500.00", "0.00"]);
  });
});

import { describe, expect, it } from "vitest";

import { controleMensuelReleves, type CreditsReleveMensuel, type VentilationEncaissementsMensuelle } from "./cptControleReleves";

const c = (n: number) => BigInt(n) * BigInt(100);

const credits = (partiel: Partial<CreditsReleveMensuel> = {}): CreditsReleveMensuel => ({ compteId: "wave", periode: "2026-03-01", nbReleves: 1, totalCredits: c(100000), ...partiel });
const ventilation = (partiel: Partial<VentilationEncaissementsMensuelle> = {}): VentilationEncaissementsMensuelle => ({
  compteId: "wave",
  periode: "2026-03-01",
  typeFlux: "ENCAISSEMENT",
  montant: c(100000),
  resteARattacher: c(100000),
  montantPasUnePrime: BigInt(0),
  ...partiel,
});

describe("controleMensuelReleves", () => {
  it("un relevé dont tous les crédits sont à rattacher est cohérent", () => {
    const [l] = controleMensuelReleves([credits()], [ventilation()]);
    expect(l).toMatchObject({ creditsReleve: c(100000), primesARattacher: c(100000), primesRattachees: BigInt(0), autresCredits: BigInt(0), virementsInternesRecus: BigInt(0), ecart: BigInt(0), coherent: true });
  });

  it("T1 : 4 500 payés = 2 500 rattachés + 2 000 pas une prime", () => {
    const [l] = controleMensuelReleves([credits({ totalCredits: c(4500) })], [ventilation({ montant: c(4500), resteARattacher: BigInt(0), montantPasUnePrime: c(2000) })]);
    expect(l.primesRattachees).toBe(c(2500));
    expect(l.autresCredits).toBe(c(2000));
    expect(l.primesARattacher).toBe(BigInt(0));
    expect(l.coherent).toBe(true);
  });

  it("répartit un encaissement entamé : rattaché + à rattacher + pas une prime", () => {
    const [l] = controleMensuelReleves([credits({ totalCredits: c(10000) })], [ventilation({ montant: c(10000), resteARattacher: c(3000), montantPasUnePrime: c(1000) })]);
    expect(l).toMatchObject({ primesRattachees: c(6000), primesARattacher: c(3000), autresCredits: c(1000), coherent: true });
  });

  it("les virements internes reçus sont comptés à part", () => {
    const [l] = controleMensuelReleves(
      [credits({ totalCredits: c(350000) })],
      [
        ventilation({ montant: c(50000), resteARattacher: c(50000) }),
        ventilation({ typeFlux: "VIREMENT_INTERNE_ENTRANT", montant: c(300000), resteARattacher: BigInt(0) }),
      ]
    );
    expect(l.virementsInternesRecus).toBe(c(300000));
    expect(l.primesARattacher).toBe(c(50000));
    expect(l.coherent).toBe(true);
  });

  it("un écart est signalé, positif quand le relevé dit plus que les encaissements", () => {
    const [l] = controleMensuelReleves([credits({ totalCredits: c(100500) })], [ventilation()]);
    expect(l.ecart).toBe(c(500));
    expect(l.coherent).toBe(false);
  });

  it("un écart négatif quand les encaissements dépassent le relevé", () => {
    const [l] = controleMensuelReleves([credits({ totalCredits: c(99000) })], [ventilation()]);
    expect(l.ecart).toBe(-c(1000));
    expect(l.coherent).toBe(false);
  });

  it("additionne les relevés d'un même compte et d'un même mois (exports partiels)", () => {
    const [l] = controleMensuelReleves(
      [credits({ nbReleves: 1, totalCredits: c(60000) }), credits({ nbReleves: 2, totalCredits: c(40000) })],
      [ventilation({ montant: c(60000), resteARattacher: c(60000) }), ventilation({ montant: c(40000), resteARattacher: c(40000) })]
    );
    expect(l.nbReleves).toBe(3);
    expect(l.creditsReleve).toBe(c(100000));
    expect(l.coherent).toBe(true);
  });

  it("ne mélange ni les comptes ni les mois", () => {
    const lignes = controleMensuelReleves(
      [credits({ compteId: "wave", periode: "2026-03-01" }), credits({ compteId: "bni", periode: "2026-03-01", totalCredits: c(50000) }), credits({ compteId: "wave", periode: "2026-04-01", totalCredits: c(7000) })],
      [ventilation(), ventilation({ compteId: "bni", montant: c(50000), resteARattacher: c(50000) }), ventilation({ periode: "2026-04-01", montant: c(7000), resteARattacher: c(7000) })]
    );
    expect(lignes).toHaveLength(3);
    expect(lignes.every((l) => l.coherent)).toBe(true);
  });

  it("trie du mois le plus récent au plus ancien, puis par compte", () => {
    const lignes = controleMensuelReleves(
      [credits({ compteId: "wave", periode: "2026-03-01" }), credits({ compteId: "bni", periode: "2026-04-01" }), credits({ compteId: "bni", periode: "2026-03-01" })],
      []
    );
    expect(lignes.map((l) => `${l.periode}/${l.compteId}`)).toEqual(["2026-04-01/bni", "2026-03-01/bni", "2026-03-01/wave"]);
  });

  it("des encaissements d'un mois sans relevé sont ignorés ; un relevé sans encaissement est un écart", () => {
    const lignes = controleMensuelReleves([credits({ totalCredits: c(5000) })], [ventilation({ periode: "2026-05-01" })]);
    expect(lignes).toHaveLength(1);
    expect(lignes[0].ecart).toBe(c(5000));
    expect(lignes[0].coherent).toBe(false);
  });

  it("aucune donnée : aucune ligne", () => {
    expect(controleMensuelReleves([], [])).toEqual([]);
  });
});

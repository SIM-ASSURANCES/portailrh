import { describe, expect, it } from "vitest";

import { assemblerPrevisionCpt, moisCpt, semainesCpt } from "./cptPrevision";

const c = (n: number) => BigInt(n);

describe("périodes", () => {
  it("semaines du lundi au dimanche autour d'aujourd'hui (mardi 24/11/2026)", () => {
    const s = semainesCpt("2026-11-24");
    expect(s).toHaveLength(13);
    expect(s[4]).toMatchObject({ debut: "2026-11-23", fin: "2026-11-29", position: "COURANTE" });
    expect(s[0]).toMatchObject({ debut: "2026-10-26", position: "PASSEE" });
    expect(s[12]).toMatchObject({ debut: "2027-01-18", position: "FUTURE" });
  });
  it("mois civils, février 2027 de 28 jours, passage d'année", () => {
    const m = moisCpt("2026-11-24");
    expect(m).toHaveLength(9);
    expect(m[3]).toMatchObject({ debut: "2026-11-01", fin: "2026-11-30", libelle: "novembre 2026", position: "COURANTE" });
    expect(m.find((x) => x.libelle === "février 2027")).toMatchObject({ debut: "2027-02-01", fin: "2027-02-28" });
    expect(m[0]).toMatchObject({ libelle: "août 2026", position: "PASSEE" });
  });
});

describe("assemblerPrevisionCpt", () => {
  const periodes = moisCpt("2026-11-24", 1, 1); // octobre, novembre, décembre 2026
  it("prévu = montants dus des échéances de la période, reste = ce qui n'est pas encore réglé, réel = encaissé prouvé de la période", () => {
    const lignes = assemblerPrevisionCpt(
      periodes,
      [
        { jour: "2026-10-05", montantDu: "1000", montantRegle: "1000" },
        { jour: "2026-10-20", montantDu: "500", montantRegle: "0" },
        { jour: "2026-11-30", montantDu: "2000", montantRegle: "500" },
        { jour: "2026-12-01", montantDu: "700", montantRegle: "0" },
      ],
      [
        { jour: "2026-10-06", montant: "1000" },
        { jour: "2026-11-10", montant: "800" },
      ],
      [{ jour: "2026-11-28", montant: "1500" }]
    );
    expect(lignes.map((l) => [l.prevu, l.resteAEncaisser, l.reel, l.promesses, l.ecart])).toEqual([
      [c(150_000), c(50_000), c(100_000), c(0), c(-50_000)],
      [c(200_000), c(150_000), c(80_000), c(150_000), c(-120_000)],
      [c(70_000), c(70_000), c(0), c(0), c(-70_000)],
    ]);
  });
  it("le réel d'une période compte un retard payé pendant la période, même s'il vient d'une échéance antérieure", () => {
    const l = assemblerPrevisionCpt(moisCpt("2026-11-24", 0, 0), [], [{ jour: "2026-11-02", montant: "900" }], []);
    expect(l[0].prevu).toBe(c(0));
    expect(l[0].reel).toBe(c(90_000));
  });
});

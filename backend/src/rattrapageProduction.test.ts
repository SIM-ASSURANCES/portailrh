import { describe, expect, it } from "vitest";

import {
  ETAPES_RATTRAPAGE,
  analyserArgumentsRattrapage,
  confirmationRattrapageValide,
  formaterBilan,
  resteAFaire,
  type BilanEtape,
} from "./rattrapageProduction";
import type { ResultatEtape } from "./rattrapageEtapes";

const R = (o: Partial<ResultatEtape> = {}): ResultatEtape => ({ examinees: 5, aTraiter: 0, traitees: 0, ambigus: 0, resume: "", ...o });
const bilan = (i: number, avant: Partial<ResultatEtape>, appliquees = 0, apres: Partial<ResultatEtape> | null = null): BilanEtape => ({
  etape: ETAPES_RATTRAPAGE[i],
  avant: R(avant),
  appliquees,
  apres: apres ? R(apres) : null,
});

describe("ordre des étapes", () => {
  it("statuts (B) avant règlements (D) avant clôture (C) avant signatures (L bis)", () => {
    expect(ETAPES_RATTRAPAGE.map((e) => e.id)).toEqual(["comptage", "statuts", "reglements", "cloture", "signatures"]);
    expect(ETAPES_RATTRAPAGE.map((e) => e.numero)).toEqual([1, 2, 3, 4, 5]);
  });
  it("le comptage est en lecture seule ; toutes les autres étapes sont idempotentes et signalées irréversibles", () => {
    expect(ETAPES_RATTRAPAGE[0].ecrit).toBe(false);
    for (const e of ETAPES_RATTRAPAGE.filter((x) => x.ecrit)) {
      expect(e.idempotente, e.id).toBe(true);
      expect(e.irreversible, e.id).toBe(true);
    }
  });
});

describe("arguments et confirmation", () => {
  it("simulation par défaut", () => {
    expect(analyserArgumentsRattrapage([])).toEqual({ appliquer: false, confirmation: null });
  });
  it("--appliquer et --confirmation (espace ou égal)", () => {
    expect(analyserArgumentsRattrapage(["--appliquer", "--confirmation", "RATTRAPER"])).toEqual({ appliquer: true, confirmation: "RATTRAPER" });
    expect(analyserArgumentsRattrapage(["--appliquer", "--confirmation=RATTRAPER"]).confirmation).toBe("RATTRAPER");
    expect(analyserArgumentsRattrapage(["--confirmation", "--appliquer"]).confirmation).toBeNull();
  });
  it("phrase exacte, casse comprise", () => {
    expect(confirmationRattrapageValide("RATTRAPER")).toBe(true);
    for (const v of ["rattraper", "RATTRAPER ", "", null, "REINITIALISER"]) expect(confirmationRattrapageValide(v)).toBe(false);
  });
});

describe("bilan", () => {
  it("en simulation : montre le « à traiter » et rappelle les étapes non défaisables", () => {
    const texte = formaterBilan([bilan(1, { aTraiter: 3 }), bilan(2, { aTraiter: 2, ambigus: 1 })], false);
    expect(texte).toMatch(/SIMULATION/);
    expect(texte).toMatch(/1 cas ambigu/);
    expect(texte).toMatch(/non défaisables par le script.*2, 3, 4, 5/);
    expect(texte).not.toMatch(/Idempotence/);
  });
  it("après application : avant, écrites, restant ; idempotence confirmée quand il ne reste rien", () => {
    const b = [bilan(1, { aTraiter: 3 }, 3, { aTraiter: 0 }), bilan(4, { aTraiter: 2 }, 2, { aTraiter: 0, ambigus: 1 })];
    const texte = formaterBilan(b, true);
    expect(texte).toMatch(/APPLIQUÉ/);
    expect(texte).toMatch(/Idempotence : une nouvelle simulation ne trouve plus RIEN/);
    expect(b.map(resteAFaire)).toEqual([0, 0]);
  });
  it("signale un reste à traiter après application", () => {
    const texte = formaterBilan([bilan(1, { aTraiter: 3 }, 2, { aTraiter: 1 })], true);
    expect(texte).toMatch(/ATTENTION : 1 élément/);
  });
});

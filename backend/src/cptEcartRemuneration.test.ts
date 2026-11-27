import { describe, expect, it } from "vitest";

import { cleEcartRemunerationCpt, detecterEcartsRemunerationCpt } from "./cptEcartRemuneration";
import type { ContratRemunerationCpt, ConventionRemunerationCpt, LigneEnregistreeCpt } from "./cptRemuneration";

const F = (fcfa: number) => BigInt(fcfa) * BigInt(100);

const contrat: ContratRemunerationCpt = {
  id: "k",
  numPolice: "POL-1",
  statut: "EN_COURS",
  produitCode: "AUTO",
  apporteurId: "courtier",
  dateEffet: "2026-03-01",
  echeances: [1, 2].map((rang) => ({ id: `e${rang}`, rang, datePrevue: `2026-0${rang + 2}-01`, etat: "A_ECHOIR" as ContratRemunerationCpt["echeances"][number]["etat"], primeHt: F(50000), accessoires: BigInt(0), primeTtc: F(60000), montantDu: F(60000), montantRegle: BigInt(0) })),
};
const convention = (nature: "COMMISSION" | "HONORAIRES", taux: string, p: Partial<ConventionRemunerationCpt> = {}): ConventionRemunerationCpt => ({
  id: `cv-${nature}`,
  partenaireId: nature === "COMMISSION" ? "courtier" : "gestionnaire",
  nature,
  produitCode: "AUTO",
  apporteurId: null,
  beneficiaireId: null,
  taux,
  base: "TTC",
  faitGenerateur: "EMISSION",
  modeReglement: "AU_PRORATA",
  dateEffet: "2020-01-01",
  dateFin: null,
  ...p,
});
const conventions = [convention("COMMISSION", "0.100000"), convention("HONORAIRES", "0.050000")];
const detecter = (commission: bigint | null, gestion: bigint | null, o: { conventions?: ConventionRemunerationCpt[]; tolerance?: bigint; enregistrees?: LigneEnregistreeCpt[] } = {}) =>
  detecterEcartsRemunerationCpt({ contrat, declares: { COMMISSION: commission, HONORAIRES: gestion }, conventions: o.conventions ?? conventions, enregistrees: o.enregistrees, toleranceCentimes: o.tolerance ?? BigInt(0) });

describe("Q19 — écart entre le bordereau et les conventions", () => {
  it("montants conformes au dû total du contrat (toutes échéances) : aucune alerte", () => {
    expect(detecter(F(12000), F(6000))).toEqual([]);
  });

  it("un montant différent donne un écart signé, par nature", () => {
    expect(detecter(F(15000), F(5000))).toEqual([
      { nature: "COMMISSION", declare: F(15000), attendu: F(12000), ecart: F(3000), conventionIds: ["cv-COMMISSION"] },
      { nature: "HONORAIRES", declare: F(5000), attendu: F(6000), ecart: F(-1000), conventionIds: ["cv-HONORAIRES"] },
    ]);
  });

  it("zéro déclaré est une valeur ; une valeur absente n'est pas comparée", () => {
    expect(detecter(BigInt(0), null).map((e) => [e.nature, e.ecart])).toEqual([["COMMISSION", F(-12000)]]);
    expect(detecter(null, null)).toEqual([]);
  });

  it("tolérance : un écart égal à la tolérance passe, un centime de plus alerte", () => {
    expect(detecter(F(12005), null, { tolerance: F(5) })).toEqual([]);
    expect(detecter(F(12005) + BigInt(1), null, { tolerance: F(5) })).toHaveLength(1);
    expect(detecter(F(12000) + BigInt(1), null)).toHaveLength(1);
  });

  it("aucune convention qui s'applique, ou deux en conflit : aucune alerte", () => {
    expect(detecter(F(1), F(1), { conventions: [] })).toEqual([]);
    expect(detecter(F(1), null, { conventions: [convention("COMMISSION", "0.100000", { dateEffet: "2026-04-01" })] })).toEqual([]);
    const conflit = [convention("COMMISSION", "0.100000"), convention("COMMISSION", "0.200000", { id: "cv-2", partenaireId: "autre", apporteurId: "courtier", beneficiaireId: "courtier" })];
    expect(detecter(F(1), null, { conventions: conflit })).toEqual([]);
  });

  it("lignes figées au premier règlement : leur convention et leur dû priment (C-31)", () => {
    const figees: LigneEnregistreeCpt[] = [1, 2].map((r) => ({ id: `l${r}`, contratId: "k", echeanceId: `e${r}`, beneficiaireId: "courtier", nature: "COMMISSION", conventionId: "cv-ancienne", du: F(3000), paye: BigInt(0), payeEnUneFois: BigInt(0) }));
    const r = detecter(F(12000), null, { conventions: [...conventions, convention("COMMISSION", "0.050000", { id: "cv-ancienne", dateEffet: "2019-01-01", dateFin: "2019-12-31" })], enregistrees: figees });
    expect(r.map((e) => [e.attendu, e.conventionIds])).toEqual([[F(6000), ["cv-ancienne"]]]);
  });

  it("une seule clé d'alerte par contrat, nature et écart", () => {
    expect(cleEcartRemunerationCpt("k", "COMMISSION", F(3000))).toBe("k|COMMISSION|300000");
    expect(cleEcartRemunerationCpt("k", "COMMISSION", F(-3000))).not.toBe(cleEcartRemunerationCpt("k", "COMMISSION", F(3000)));
  });
});

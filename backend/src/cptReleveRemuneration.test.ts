import { describe, expect, it } from "vitest";

import { ligneCsv } from "./cptExportCsv";
import { colonnesReleveRemunerationCpt, construireReleveRemunerationCpt, lignesExportReleveRemunerationCpt } from "./cptReleveRemuneration";
import { lignesContratCpt, type ContratRemunerationCpt, type ConventionRemunerationCpt, type LigneEnregistreeCpt } from "./cptRemuneration";

const F = (fcfa: number) => BigInt(fcfa) * BigInt(100);
const conventions: ConventionRemunerationCpt[] = (["COMMISSION", "HONORAIRES"] as const).map((nature) => ({
  id: nature,
  partenaireId: "cabinet",
  beneficiaireId: null,
  produitCode: null,
  apporteurId: null,
  nature,
  taux: nature === "COMMISSION" ? "0.100000" : "0.050000",
  base: "TTC",
  faitGenerateur: "EMISSION",
  modeReglement: "EN_UNE_FOIS",
  dateEffet: "2020-01-01",
  dateFin: null,
}));
const contrat: ContratRemunerationCpt = {
  id: "k",
  numPolice: "POL-1",
  statut: "EN_COURS",
  produitCode: "P",
  apporteurId: "cabinet",
  dateEffet: "2026-01-01",
  echeances: [{ id: "e1", rang: 1, datePrevue: "2026-01-01", etat: "OUVERTE", primeHt: F(100000), accessoires: BigInt(0), primeTtc: F(100000), montantDu: F(100000), montantRegle: F(40000) }],
};
const enregistrees: LigneEnregistreeCpt[] = [
  // Commission : 4 000 réglés, puis 1 000 repris par compensation vers les honoraires.
  { id: "lc", contratId: "k", echeanceId: "e1", beneficiaireId: "cabinet", nature: "COMMISSION", conventionId: "COMMISSION", du: F(10000), paye: F(3000), payeEnUneFois: BigInt(0) },
  { id: "lh", contratId: "k", echeanceId: "e1", beneficiaireId: "cabinet", nature: "HONORAIRES", conventionId: "HONORAIRES", du: F(5000), paye: F(1000), payeEnUneFois: BigInt(0) },
];
const lignes = lignesContratCpt({ contrat, conventions, enregistrees }).lignes;
const reglement = { reference: "CPR-2026-000001", date: "2026-02-01", montant: F(4000), montantAvance: BigInt(0), mode: "VIREMENT" as const, referenceReglement: "V-1", creeAt: "2026-02-01T09:00:00.000Z" };
const compensation = { date: "2026-03-01", natureSource: "COMMISSION" as const, natureCible: "HONORAIRES" as const, montant: F(1000), motif: "Compensation convenue", creeAt: "2026-03-01T09:00:00.000Z" };
const releve = (nature: "COMMISSION" | "HONORAIRES") =>
  construireReleveRemunerationCpt({ nature, lignes, clients: new Map([["k", { clientNom: "Client" }]]), reglements: nature === "COMMISSION" ? [reglement] : [], compensations: [compensation] });

describe("GC-9g — relevé par partenaire et par nature", () => {
  it("une seule nature ; les mouvements (règlements, compensations signées) font le payé du solde", () => {
    for (const nature of ["COMMISSION", "HONORAIRES"] as const) {
      const r = releve(nature);
      expect(r.lignes.every((l) => l.nature === nature)).toBe(true);
      expect(r.mouvements.reduce((s, m) => s + m.montant, BigInt(0))).toBe(r.solde.paye);
    }
    expect(releve("COMMISSION").mouvements.map((m) => [m.type, m.montant])).toEqual([
      ["REGLEMENT", F(4000)],
      ["COMPENSATION", F(-1000)],
    ]);
  });

  it("le même jour, les mouvements suivent l'ordre de saisie (un règlement avant la compensation qui reprend son avance)", () => {
    const r = construireReleveRemunerationCpt({
      nature: "COMMISSION",
      lignes,
      clients: new Map(),
      reglements: [{ ...reglement, date: "2026-03-01", creeAt: "2026-03-01T08:00:00.000Z" }],
      compensations: [compensation],
    });
    expect(r.mouvements.map((m) => m.type)).toEqual(["REGLEMENT", "COMPENSATION"]);
  });

  it("honoraires : ventilation encaissées / non encaissées ; les autres natures n'ont pas ces colonnes", () => {
    expect(releve("HONORAIRES").honoraires).toEqual({ surPrimesEncaissees: F(2000), surPrimesNonEncaissees: F(3000) });
    expect(releve("COMMISSION").honoraires).toBeNull();
    expect(colonnesReleveRemunerationCpt("COMMISSION").map((c) => c.cle)).not.toContain("encaissees");
    expect(colonnesReleveRemunerationCpt("HONORAIRES").map((c) => c.cle)).toContain("nonEncaissees");
  });

  it("export : échéances, mouvements puis total égal au solde ; une reprise reste un nombre négatif en CSV", () => {
    const r = releve("COMMISSION");
    const exportes = lignesExportReleveRemunerationCpt(r);
    expect(exportes.map((l) => l.section)).toEqual(["Échéance", "Règlement", "Compensation", "Total"]);
    expect(exportes.at(-1)).toMatchObject({ du: 10000, paye: 3000, mouvement: 3000 });
    const csv = ligneCsv(colonnesReleveRemunerationCpt("COMMISSION"), exportes[2]);
    expect(csv).toContain(";-1000,00;");
  });
});

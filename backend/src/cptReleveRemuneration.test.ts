import { describe, expect, it } from "vitest";

import { ligneCsv } from "./cptExportCsv";
import { colonnesReleveRemunerationCpt, construireReleveRemunerationCpt, lignesExportReleveRemunerationCpt, titreMouvementReleveCpt, libellePeriodeReleveCpt, lirePeriodeReleveCpt, requetePeriodeReleveCpt, trimestreCivilCpt } from "./cptReleveRemuneration";
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
const reglement = { reference: "CPR-2026-000001", date: "2026-02-01", montant: F(4000), montantAvance: BigInt(0), mode: "VIREMENT" as const, referenceReglement: "V-1", creeAt: "2026-02-01T09:00:00.000Z", annulation: null };
const compensation = { date: "2026-03-01", natureSource: "COMMISSION" as const, natureCible: "HONORAIRES" as const, montant: F(1000), motif: "Compensation convenue", creeAt: "2026-03-01T09:00:00.000Z", annulation: null };
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

  it("une opération annulée reste visible, suivie de son annulation à SA date ; leur somme est nulle", () => {
    const r = construireReleveRemunerationCpt({
      nature: "COMMISSION",
      lignes,
      clients: new Map(),
      reglements: [
        reglement,
        { ...reglement, reference: "CPR-2026-000002", date: "2026-02-15", creeAt: "2026-02-15T09:00:00.000Z", annulation: { date: "2026-04-02", creeAt: "2026-04-02T10:00:00.000Z", motif: "Saisi deux fois" } },
      ],
      compensations: [compensation],
    });
    expect(r.mouvements.map((m) => [m.date, titreMouvementReleveCpt(m), m.montant])).toEqual([
      ["2026-02-01", "CPR-2026-000001", F(4000)],
      ["2026-02-15", "CPR-2026-000002", F(4000)],
      ["2026-03-01", "Compensation", F(-1000)],
      ["2026-04-02", "Annulation CPR-2026-000002", F(-4000)],
    ]);
    expect(r.mouvements.at(-1)!.detail).toBe("Annulation du règlement CPR-2026-000002 — Saisi deux fois");
    // Le payé vient des lignes (chargées sans les opérations annulées) : il reste égal à la somme des mouvements.
    expect(r.mouvements.reduce((s, m) => s + m.montant, BigInt(0))).toBe(r.solde.paye);
    expect(lignesExportReleveRemunerationCpt(r).map((l) => l.section)).toEqual(["Solde d'ouverture", "Échéance", "Règlement", "Règlement", "Compensation", "Annulation", "Total de la période", "Solde de clôture"]);
  });

  it("une compensation annulée est contre-passée avec le signe opposé", () => {
    const r = construireReleveRemunerationCpt({ nature: "HONORAIRES", lignes, clients: new Map(), reglements: [], compensations: [{ ...compensation, annulation: { date: "2026-04-02", creeAt: "2026-04-02T10:00:00.000Z", motif: "Erreur de saisie" } }] });
    expect(r.mouvements.map((m) => [m.type, m.montant])).toEqual([
      ["COMPENSATION", F(1000)],
      ["ANNULATION", F(-1000)],
    ]);
    expect(r.mouvements[1].detail).toBe("Annulation de la compensation du 01/03/2026 — Erreur de saisie");
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
    expect(exportes.map((l) => l.section)).toEqual(["Solde d'ouverture", "Échéance", "Règlement", "Compensation", "Total de la période", "Solde de clôture"]);
    expect(exportes.at(-2)).toMatchObject({ du: 10000, paye: 3000, mouvement: 3000 });
    expect(exportes.at(-1)).toMatchObject({ solde: 7000 });
    const csv = ligneCsv(colonnesReleveRemunerationCpt("COMMISSION"), exportes[3]);
    expect(csv).toContain(";-1000,00;");
  });
});

describe("Q24 — période du relevé", () => {
  it("par défaut le trimestre civil en cours ; « tout » ; une seule date complétée ; saisie incohérente ignorée", () => {
    expect(lirePeriodeReleveCpt({}, "2026-11-27")).toEqual({ du: "2026-10-01", au: "2026-12-31" });
    expect(trimestreCivilCpt("2026-03-31")).toEqual({ du: "2026-01-01", au: "2026-03-31" });
    expect(trimestreCivilCpt("2026-04-01")).toEqual({ du: "2026-04-01", au: "2026-06-30" });
    expect(lirePeriodeReleveCpt({ periode: "tout" }, "2026-11-27")).toEqual({ du: null, au: null });
    expect(lirePeriodeReleveCpt({ du: "2026-01-15", au: "2026-02-14" }, "2026-11-27")).toEqual({ du: "2026-01-15", au: "2026-02-14" });
    expect(lirePeriodeReleveCpt({ du: "2026-05-10" }, "2026-11-27")).toEqual({ du: "2026-05-10", au: "2026-06-30" });
    expect(lirePeriodeReleveCpt({ au: "2026-05-10" }, "2026-11-27")).toEqual({ du: "2026-04-01", au: "2026-05-10" });
    expect(lirePeriodeReleveCpt({ du: "2026-06-01", au: "2026-05-01" }, "2026-11-27")).toEqual({ du: "2026-10-01", au: "2026-12-31" });
    expect(lirePeriodeReleveCpt({ du: "2026-02-30", au: "x" }, "2026-11-27")).toEqual({ du: "2026-10-01", au: "2026-12-31" });
    expect(requetePeriodeReleveCpt({ du: null, au: null })).toBe("periode=tout");
    expect(libellePeriodeReleveCpt({ du: "2026-10-01", au: "2026-12-31" })).toBe("Du 01/10/2026 au 31/12/2026");
  });

  const periodique = (du: string | null, au: string | null) =>
    construireReleveRemunerationCpt({ nature: "COMMISSION", lignes, clients: new Map(), reglements: [reglement], compensations: [compensation], periode: { du, au } });

  it("solde d'ouverture = tout ce qui précède ; clôture = ouverture + dû de la période − versements de la période", () => {
    // Échéance prévue le 01/01/2026 (dû 10 000), règlement 4 000 le 01/02, compensation −1 000 le 01/03.
    const fevrier = periodique("2026-02-01", "2026-02-28");
    expect(fevrier.soldePeriode).toEqual({ ouverture: F(10000), duPeriode: BigInt(0), versementsPeriode: F(4000), cloture: F(6000) });
    expect(fevrier.lignes).toHaveLength(0);
    expect(fevrier.mouvements.map((m) => m.type)).toEqual(["REGLEMENT"]);
    const mars = periodique("2026-03-01", "2026-03-31");
    expect(mars.soldePeriode.ouverture).toBe(fevrier.soldePeriode.cloture);
    expect(mars.soldePeriode.cloture).toBe(F(7000));
  });

  it("tout l'historique : ouverture nulle, clôture = reste dû à ce jour ; la situation ne dépend pas de la période", () => {
    const tout = periodique(null, null);
    expect(tout.soldePeriode.ouverture).toBe(BigInt(0));
    expect(tout.soldePeriode.cloture).toBe(tout.solde.resteDu);
    expect(periodique("2027-01-01", "2027-03-31").solde).toEqual(tout.solde);
    expect(periodique("2027-01-01", "2027-03-31").soldePeriode).toEqual({ ouverture: F(7000), duPeriode: BigInt(0), versementsPeriode: BigInt(0), cloture: F(7000) });
  });
});

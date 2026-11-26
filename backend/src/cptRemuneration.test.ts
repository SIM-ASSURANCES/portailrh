import { describe, expect, it } from "vitest";

import { construireEcheancier, enCentimesEcheancier } from "./cptEcheancier";
import {
  calculerLigneCpt,
  conventionsApplicablesCpt,
  dusInitiauxCpt,
  lignesContratCpt,
  soldesParNatureCpt,
  tauxRemunerationEnMillioniemesCpt,
  type ContratRemunerationCpt,
  type ConventionRemunerationCpt,
  type EcheanceRemunerationCpt,
  type LigneEnregistreeCpt,
  type LigneRemunerationCalculeeCpt,
} from "./cptRemuneration";

const F = (fcfa: number) => BigInt(fcfa) * BigInt(100);

function convention(c: Partial<ConventionRemunerationCpt> & Pick<ConventionRemunerationCpt, "id" | "partenaireId" | "nature">): ConventionRemunerationCpt {
  return {
    produitCode: null,
    apporteurId: null,
    dateEffet: "2020-01-01",
    dateFin: null,
    taux: "0.100000",
    base: "TTC",
    faitGenerateur: "EMISSION",
    modeReglement: "AU_PRORATA",
    beneficiaireId: null,
    ...c,
  };
}

/** Échéancier réel du module (`construireEcheancier`), puis encaissé échéance par échéance. */
function contrat(
  p: Partial<ContratRemunerationCpt> & { prime?: number; mensuel?: boolean; regle?: number[]; accessoires?: number; taxe?: number },
): ContratRemunerationCpt {
  const r = construireEcheancier({
    fractionnement: p.mensuel ? "MENSUEL" : "COMPTANT",
    dateEffet: "2026-01-01",
    dateEcheance: "2026-12-31",
    primeTtc: p.prime ?? 120000,
    accessoires: p.accessoires ?? 0,
    taxe: p.taxe ?? 0,
  });
  if (!r.ok) throw new Error(r.erreur);
  const c = (t: string) => enCentimesEcheancier(t)!;
  const echeances: EcheanceRemunerationCpt[] = r.echeances.map((e, i) => {
    const regle = F(p.regle?.[i] ?? 0);
    return {
      id: `${p.id ?? "k"}-e${e.rang}`,
      rang: e.rang,
      datePrevue: e.datePrevue,
      etat: regle >= c(e.montantDu) ? "SOLDEE" : "OUVERTE",
      primeHt: c(e.primeHt),
      accessoires: c(e.accessoires),
      primeTtc: c(e.primeTtc),
      montantDu: c(e.montantDu),
      montantRegle: regle,
    };
  });
  return { id: p.id ?? "k", numPolice: p.numPolice ?? "POL-1", statut: p.statut ?? "EN_COURS", produitCode: p.produitCode ?? "P1", apporteurId: p.apporteurId ?? null, dateEffet: "2026-01-01", echeances };
}

const somme = (lignes: LigneRemunerationCalculeeCpt[], cle: "du" | "payable" | "exigible" | "restePayable" | "resteDu" | "paye" | "avance") =>
  lignes.reduce((s, l) => s + l[cle], BigInt(0));

/** Rejoue l'enregistrement de lignes après un règlement : `payes[rang]` FCFA affectés à l'échéance du rang. */
function enregistrer(lignes: LigneRemunerationCalculeeCpt[], payes: Record<number, number>): LigneEnregistreeCpt[] {
  return lignes.map((l) => ({
    id: `l-${l.rang}`,
    contratId: l.contratId,
    echeanceId: l.echeanceId,
    beneficiaireId: l.beneficiaireId,
    nature: l.nature,
    conventionId: l.conventionId,
    du: l.duInitial,
    paye: F(payes[l.rang] ?? 0),
    payeEnUneFois: BigInt(0),
  }));
}

describe("GC-9b — T6 ter : 120 000 en 12 mensualités, commission 12 000 au prorata", () => {
  const courtier = convention({ id: "cv", partenaireId: "courtier", nature: "COMMISSION" });
  const k = contrat({ mensuel: true, apporteurId: "courtier", regle: [10000, 10000, 10000] });

  it("3 mensualités encaissées : dû 12 000, exigible 12 000 (émission), payable 3 000", () => {
    const { lignes, conflits } = lignesContratCpt({ contrat: k, conventions: [courtier] });
    expect(conflits).toEqual([]);
    expect(lignes).toHaveLength(12);
    expect(somme(lignes, "du")).toBe(F(12000));
    expect(somme(lignes, "exigible")).toBe(F(12000));
    expect(somme(lignes, "payable")).toBe(F(3000));
    expect(soldesParNatureCpt(lignes).COMMISSION.montantReglable).toBe(F(3000));
  });

  it("après un règlement de 3 000 : reste payable 0, reste dû 9 000, aucune avance", () => {
    const avant = lignesContratCpt({ contrat: k, conventions: [courtier] }).lignes;
    const { lignes } = lignesContratCpt({ contrat: k, conventions: [courtier], enregistrees: enregistrer(avant, { 1: 1000, 2: 1000, 3: 1000 }) });
    const s = soldesParNatureCpt(lignes).COMMISSION;
    expect(s.paye).toBe(F(3000));
    expect(s.restePayable).toBe(BigInt(0));
    expect(s.montantReglable).toBe(BigInt(0));
    expect(s.resteDu).toBe(F(9000));
    expect(s.avance).toBe(BigInt(0));
  });

  it("« en une fois » décidé par le RFCRH sur le contrat : tout l'exigible devient payable ; la décision la plus récente l'emporte", () => {
    const decision = (mode: "EN_UNE_FOIS" | "AU_PRORATA", decideAt: string) => ({ contratId: "k", beneficiaireId: "courtier", nature: "COMMISSION" as const, mode, decideAt });
    const une = lignesContratCpt({ contrat: k, conventions: [courtier], decisions: [decision("EN_UNE_FOIS", "2026-02-01T10:00:00.000Z")] }).lignes;
    expect(somme(une, "payable")).toBe(F(12000));
    expect(une.every((l) => l.modeDecide && l.mode === "EN_UNE_FOIS")).toBe(true);
    const revenu = lignesContratCpt({
      contrat: k,
      conventions: [courtier],
      decisions: [decision("AU_PRORATA", "2026-03-01T10:00:00.000Z"), decision("EN_UNE_FOIS", "2026-02-01T10:00:00.000Z")],
    }).lignes;
    expect(somme(revenu, "payable")).toBe(F(3000));
  });

  it("payé par un règlement décidé « en une fois » : considéré payable, jamais une avance, sans rendre le reste payable", () => {
    const avant = lignesContratCpt({ contrat: k, conventions: [courtier] }).lignes;
    const enBase = enregistrer(avant, { 4: 1000 }).map((l) => (l.id === "l-4" ? { ...l, payeEnUneFois: F(1000) } : l));
    const { lignes } = lignesContratCpt({ contrat: k, conventions: [courtier], enregistrees: enBase });
    expect(somme(lignes, "avance")).toBe(BigInt(0));
    expect(lignes[3]).toMatchObject({ payable: F(1000), restePayable: BigInt(0) });
    expect(lignes[4].payable).toBe(BigInt(0));
  });
});

describe("GC-9b — T6 : courtier en commission, gestionnaire santé en honoraires, deux soldes sans effet croisé", () => {
  const conventions = [
    convention({ id: "cv-c", partenaireId: "courtier", nature: "COMMISSION", taux: "0.150000", base: "PRIME_NETTE", modeReglement: "EN_UNE_FOIS" }),
    convention({ id: "cv-h", partenaireId: "gestionnaire", nature: "HONORAIRES", taux: "0.050000", base: "TTC", modeReglement: "EN_UNE_FOIS" }),
  ];
  const k = contrat({ apporteurId: "courtier", prime: 200000, accessoires: 10000, taxe: 3000, regle: [200000] });
  const { lignes } = lignesContratCpt({ contrat: k, conventions });
  const duCourtier = lignes.filter((l) => l.beneficiaireId === "courtier");
  const duGestionnaire = lignes.filter((l) => l.beneficiaireId === "gestionnaire");

  it("commission 15 % de la prime nette (187 000 → 28 050) ; honoraires 5 % du TTC (10 000)", () => {
    expect(duCourtier.map((l) => [l.nature, l.du])).toEqual([["COMMISSION", F(28050)]]);
    expect(duGestionnaire.map((l) => [l.nature, l.du])).toEqual([["HONORAIRES", F(10000)]]);
  });

  it("deux soldes distincts : payer la commission ne change rien aux honoraires, et inversement", () => {
    const enBase = enregistrer(duCourtier, { 1: 28050 });
    const apres = lignesContratCpt({ contrat: k, conventions, enregistrees: enBase }).lignes;
    const soldes = soldesParNatureCpt(apres);
    expect(soldes.COMMISSION).toMatchObject({ paye: F(28050), montantReglable: BigInt(0) });
    expect(soldes.HONORAIRES).toMatchObject({ paye: BigInt(0), montantReglable: F(10000) });
    expect(soldes.ACCESSOIRES.du).toBe(BigInt(0));
  });

  it("une avance sur une nature ne réduit jamais le montant à verser d'une autre (aucune compensation automatique)", () => {
    const enBase = enregistrer(duCourtier, { 1: 28050 });
    const abandon = { ...k, statut: "ANNULE", echeances: k.echeances.map((e) => ({ ...e, montantRegle: BigInt(0), etat: "ANNULEE" as const })) };
    const soldes = soldesParNatureCpt(lignesContratCpt({ contrat: abandon, conventions, enregistrees: enBase }).lignes);
    expect(soldes.COMMISSION).toMatchObject({ du: BigInt(0), avanceNette: F(28050), aRegulariser: F(28050) });
    expect(soldes.HONORAIRES.avanceNette).toBe(BigInt(0));
  });
});

describe("GC-9b — conventions applicables (jamais devinées)", () => {
  const k = contrat({ apporteurId: "apporteur-x" });

  it("une commission sans apporteur désigné ne vaut que pour les contrats apportés par le partenaire", () => {
    const c = convention({ id: "cv", partenaireId: "autre-courtier", nature: "COMMISSION" });
    expect(conventionsApplicablesCpt([c], k).retenues).toEqual([]);
    expect(conventionsApplicablesCpt([c], { ...k, apporteurId: "autre-courtier" }).retenues).toEqual([c]);
  });

  it("bénéficiaire différent de l'apporteur : la convention désigne l'apporteur et le bénéficiaire", () => {
    const c = convention({ id: "cv", partenaireId: "reseau", nature: "COMMISSION", apporteurId: "apporteur-x", beneficiaireId: "holding" });
    const { lignes } = lignesContratCpt({ contrat: k, conventions: [c] });
    expect(lignes.map((l) => l.beneficiaireId)).toEqual(["holding"]);
  });

  it("des honoraires sans apporteur désigné s'appliquent quel que soit l'apporteur, y compris SIM", () => {
    const c = convention({ id: "cv", partenaireId: "gestionnaire", nature: "HONORAIRES" });
    expect(conventionsApplicablesCpt([c], { ...k, apporteurId: null }).retenues).toEqual([c]);
    expect(conventionsApplicablesCpt([c], k).retenues).toEqual([c]);
  });

  it("convention choisie à la date d'effet du contrat ; hors période : aucune ligne", () => {
    const ancienne = convention({ id: "a", partenaireId: "apporteur-x", nature: "COMMISSION", taux: "0.050000", dateEffet: "2025-01-01", dateFin: "2025-12-31" });
    const courante = convention({ id: "b", partenaireId: "apporteur-x", nature: "COMMISSION", taux: "0.100000", dateEffet: "2026-01-01" });
    const future = convention({ id: "c", partenaireId: "apporteur-x", nature: "ACCESSOIRES", dateEffet: "2026-02-01" });
    expect(conventionsApplicablesCpt([ancienne, courante, future], k).retenues.map((c) => c.id)).toEqual(["b"]);
  });

  it("deux conventions pour le même bénéficiaire et la même nature : aucune retenue, conflit signalé", () => {
    const directe = convention({ id: "a", partenaireId: "apporteur-x", nature: "COMMISSION" });
    const detournee = convention({ id: "b", partenaireId: "reseau", nature: "COMMISSION", apporteurId: "apporteur-x", beneficiaireId: "apporteur-x" });
    const r = lignesContratCpt({ contrat: k, conventions: [directe, detournee] });
    expect(r.lignes).toEqual([]);
    expect(r.conflits).toMatchObject([{ beneficiaireId: "apporteur-x", nature: "COMMISSION", conventionIds: ["a", "b"] }]);
  });

  it("la convention et le dû figés d'une ligne enregistrée priment sur une convention ajoutée ensuite", () => {
    const initiale = convention({ id: "a", partenaireId: "apporteur-x", nature: "COMMISSION", taux: "0.100000" });
    const plusPrecise = convention({ id: "b", partenaireId: "apporteur-x", nature: "COMMISSION", taux: "0.200000", produitCode: "P1" });
    const avant = lignesContratCpt({ contrat: k, conventions: [initiale] }).lignes;
    const apres = lignesContratCpt({ contrat: k, conventions: [initiale, plusPrecise], enregistrees: enregistrer(avant, { 1: 12000 }) }).lignes;
    expect(apres.map((l) => [l.conventionId, l.du])).toEqual([["a", F(12000)]]);
  });
});

describe("GC-9b — arrondi D4, fait générateur, primes abandonnées", () => {
  it("taux lus en millionièmes, 100 % accepté, au-delà refusé", () => {
    expect(tauxRemunerationEnMillioniemesCpt("0.072500")).toBe(BigInt(72500));
    expect(tauxRemunerationEnMillioniemesCpt("1.000000")).toBe(BigInt(1000000));
    expect(tauxRemunerationEnMillioniemesCpt("1.000001")).toBeNull();
    expect(tauxRemunerationEnMillioniemesCpt("-0.1")).toBeNull();
  });

  it("total arrondi à l'unité, reliquat exact sur la dernière échéance", () => {
    const k = contrat({ mensuel: true, prime: 100000 });
    const dus = dusInitiauxCpt(k.echeances, "0.070000", "TTC")!;
    expect(dus.reduce((s, d) => s + d, BigInt(0))).toBe(F(7000));
    expect(dus.every((d) => d % BigInt(100) === BigInt(0))).toBe(true);
    expect(Math.max(...dus.map(Number)) - Math.min(...dus.map(Number))).toBeLessThanOrEqual(100);
  });

  it("les trois bases de convention", () => {
    const k = contrat({ prime: 100000, accessoires: 5000, taxe: 7000 });
    expect(dusInitiauxCpt(k.echeances, "0.100000", "PRIME_NETTE")).toEqual([F(8800)]);
    expect(dusInitiauxCpt(k.echeances, "0.100000", "NETTE_PLUS_ACCESSOIRES")).toEqual([F(9300)]);
    expect(dusInitiauxCpt(k.echeances, "0.100000", "TTC")).toEqual([F(10000)]);
  });

  it("fait générateur « encaissement » : exigible et payable au prorata, même « en une fois »", () => {
    const base = { contrat: { statut: "EN_COURS" }, echeance: { etat: "OUVERTE" as const, montantDu: F(10000), montantRegle: F(2500) }, duInitial: F(1000), paye: BigInt(0) };
    expect(calculerLigneCpt({ ...base, faitGenerateur: "ENCAISSEMENT", mode: "EN_UNE_FOIS" })).toMatchObject({ du: F(1000), exigible: F(250), payable: F(250) });
    expect(calculerLigneCpt({ ...base, faitGenerateur: "EMISSION", mode: "EN_UNE_FOIS" })).toMatchObject({ exigible: F(1000), payable: F(1000) });
  });

  it("prime abandonnée : seul le dû sur la part encaissée reste, le reste est à régulariser, le trop versé devient une avance", () => {
    const l = calculerLigneCpt({
      contrat: { statut: "RESILIE" },
      echeance: { etat: "OUVERTE", montantDu: F(10000), montantRegle: F(4000) },
      duInitial: F(1000),
      faitGenerateur: "EMISSION",
      mode: "EN_UNE_FOIS",
      paye: F(1000),
    });
    expect(l).toMatchObject({ du: F(400), exigible: F(400), payable: F(400), avance: F(600), aRegulariser: F(600), resteDu: BigInt(0) });
  });
});

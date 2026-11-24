import { describe, expect, it } from "vitest";

import {
  bilanReconnaissance,
  ecartJours,
  enLigneComplete,
  estFraisReleve,
  estRemboursementReleve,
  estTransactionTestReleve,
  reconnaitreLignesReleve,
  type ContrepartieVirement,
  type LigneReleveComplete,
} from "./cptReconnaissance";
import type { LigneReleve } from "./cptReleve";

const c = (n: number) => BigInt(n) * BigInt(100);

function ligne(partiel: Partial<LigneReleveComplete> = {}): LigneReleveComplete {
  return {
    numeroLigne: 2,
    reference: "T_AAAAAAAAAA1",
    dateValeur: "2026-03-10",
    montant: c(100000),
    frais: null,
    net: null,
    typeSource: null,
    payeur: null,
    telephone: null,
    referenceClient: null,
    libelle: null,
    sessionPaiement: null,
    ...partiel,
  };
}

const CTX = { compteId: "co-wave", referencesExistantes: new Set<string>() };

function contrepartie(partiel: Partial<ContrepartieVirement> = {}): ContrepartieVirement {
  return { id: "x1", compteId: "co-bni", dateValeur: "2026-03-10", montant: c(300000), sens: "ENTREE", ...partiel };
}

describe("reconnaissance par le texte", () => {
  it("transaction test : mot entier « test » dans le type ou le payeur", () => {
    expect(estTransactionTestReleve({ typeSource: "test_payment", payeur: null })).toBe(false); // « test_payment » : le trait bas est un caractère de mot
    expect(estTransactionTestReleve({ typeSource: "api checkout test", payeur: null })).toBe(true);
    expect(estTransactionTestReleve({ typeSource: null, payeur: "TEST" })).toBe(true);
    expect(estTransactionTestReleve({ typeSource: null, payeur: "Awa Testé" })).toBe(false);
    expect(estTransactionTestReleve({ typeSource: null, payeur: "Testament SA" })).toBe(false);
    expect(estTransactionTestReleve({ typeSource: null, payeur: null })).toBe(false);
  });

  it("remboursement : refund / remboursement dans le type, ou libellé qui commence par « remboursement »", () => {
    expect(estRemboursementReleve({ typeSource: "refund", libelle: null })).toBe(true);
    expect(estRemboursementReleve({ typeSource: "Remboursement client", libelle: null })).toBe(true);
    expect(estRemboursementReleve({ typeSource: null, libelle: "REMBOURSEMENT PRIME" })).toBe(true);
    expect(estRemboursementReleve({ typeSource: null, libelle: "Prime sans remboursement" })).toBe(false);
    expect(estRemboursementReleve({ typeSource: "merchant_payment", libelle: null })).toBe(false);
  });

  it("frais : mot entier fee, frais, commission, agios", () => {
    expect(estFraisReleve({ typeSource: "fee", libelle: null })).toBe(true);
    expect(estFraisReleve({ typeSource: null, libelle: "FRAIS DE TENUE DE COMPTE" })).toBe(true);
    expect(estFraisReleve({ typeSource: null, libelle: "AGIOS TRIMESTRE" })).toBe(true);
    expect(estFraisReleve({ typeSource: null, libelle: "Prime sans frais de dossier" })).toBe(false);
    expect(estFraisReleve({ typeSource: "merchant_payment", libelle: null })).toBe(false);
  });
});

describe("classement d'une ligne", () => {
  it("crédit ordinaire = ENCAISSEMENT, débit ordinaire = AUTRE_DEBIT", () => {
    const [a, b] = reconnaitreLignesReleve([ligne({ numeroLigne: 2 }), ligne({ numeroLigne: 3, reference: "B", montant: -c(5000) })], CTX);
    expect(a).toMatchObject({ decision: "A_CREER", typeFlux: "ENCAISSEMENT", raison: "CREDIT" });
    expect(b).toMatchObject({ decision: "A_CREER", typeFlux: "AUTRE_DEBIT", raison: "DEBIT" });
  });

  it("remboursement en débit reconnu ; remboursement REÇU en crédit signalé et laissé en crédit", () => {
    const [sortie, entree] = reconnaitreLignesReleve(
      [ligne({ typeSource: "refund", montant: -c(2000) }), ligne({ numeroLigne: 3, reference: "B", typeSource: "refund", montant: c(2000) })],
      CTX
    );
    expect(sortie).toMatchObject({ typeFlux: "REMBOURSEMENT", raison: "REMBOURSEMENT", signalements: [] });
    expect(entree.typeFlux).toBe("ENCAISSEMENT");
    expect(entree.signalements.map((s) => s.code)).toEqual(["REMBOURSEMENT_RECU"]);
  });

  it("transaction test reconnue, quel que soit le sens, et prioritaire sur le remboursement", () => {
    const [t1, t2] = reconnaitreLignesReleve(
      [ligne({ payeur: "TEST", montant: c(100) }), ligne({ numeroLigne: 3, reference: "B", typeSource: "refund", payeur: "TEST", montant: -c(100) })],
      CTX
    );
    expect(t1.typeFlux).toBe("TEST");
    expect(t2.typeFlux).toBe("TEST");
  });

  it("frais reconnus pour un débit seulement", () => {
    const [debit, credit] = reconnaitreLignesReleve(
      [ligne({ libelle: "FRAIS DE TENUE", montant: -c(1500) }), ligne({ numeroLigne: 3, reference: "B", libelle: "FRAIS DE DOSSIER RETROCEDES", montant: c(1500) })],
      CTX
    );
    expect(debit).toMatchObject({ typeFlux: "FRAIS", raison: "FRAIS" });
    expect(credit.typeFlux).toBe("ENCAISSEMENT");
  });

  it("un montant nul est classé en débit ordinaire (le contrôle du relevé l'a déjà signalé)", () => {
    expect(reconnaitreLignesReleve([ligne({ montant: BigInt(0) })], CTX)[0].raison).toBe("DEBIT");
  });
});

describe("anti-doublon (RG-04, T9)", () => {
  it("une référence déjà importée pour ce compte n'est pas recréée", () => {
    const r = reconnaitreLignesReleve([ligne({ reference: "T_AAAAAAAAAA1" }), ligne({ numeroLigne: 3, reference: "T_NOUVELLE0001" })], {
      ...CTX,
      referencesExistantes: new Set(["T_AAAAAAAAAA1"]),
    });
    expect(r[0]).toMatchObject({ decision: "DEJA_IMPORTEE", raison: "DEJA_IMPORTEE" });
    expect(r[1].decision).toBe("A_CREER");
    const b = bilanReconnaissance(r);
    expect(b).toMatchObject({ nbLignes: 2, nbACreer: 1, nbDejaImportees: 1 });
  });

  it("un relevé importé deux fois ne crée rien la seconde fois", () => {
    const lignes = [ligne({ numeroLigne: 2 }), ligne({ numeroLigne: 3, reference: "B", montant: -c(2000), typeSource: "refund" }), ligne({ numeroLigne: 4, reference: "C", payeur: "TEST" })];
    const premiere = reconnaitreLignesReleve(lignes, CTX);
    expect(bilanReconnaissance(premiere).nbACreer).toBe(3);
    const secondes = reconnaitreLignesReleve(lignes, { ...CTX, referencesExistantes: new Set(premiere.map((r) => r.reference)) });
    expect(bilanReconnaissance(secondes)).toMatchObject({ nbACreer: 0, nbDejaImportees: 3 });
  });

  it("la même référence sur un AUTRE compte n'est pas un doublon (le contexte ne porte que les références de CE compte)", () => {
    expect(reconnaitreLignesReleve([ligne({ reference: "VIR-1" })], { ...CTX, referencesExistantes: new Set() })[0].decision).toBe("A_CREER");
  });

  it("une ligne déjà importée n'est jamais appariée à un virement", () => {
    const r = reconnaitreLignesReleve([ligne({ montant: -c(300000) })], { ...CTX, referencesExistantes: new Set(["T_AAAAAAAAAA1"]), contreparties: [contrepartie()] });
    expect(r[0].decision).toBe("DEJA_IMPORTEE");
    expect(r[0].contrepartieId).toBeUndefined();
  });
});

describe("virements internes", () => {
  it("T9 : le débit Wave est apparié au crédit BNI déjà en base", () => {
    const [r] = reconnaitreLignesReleve([ligne({ montant: -c(300000), dateValeur: "2026-03-10" })], { ...CTX, contreparties: [contrepartie({ dateValeur: "2026-03-11" })] });
    expect(r).toMatchObject({ typeFlux: "VIREMENT_INTERNE_SORTANT", raison: "VIREMENT_APPARIE", contrepartieId: "x1" });
  });

  it("dans l'autre sens : un crédit BNI est apparié au débit Wave déjà en base", () => {
    const [r] = reconnaitreLignesReleve([ligne({ montant: c(300000), reference: "VIR-BNI-1" })], {
      compteId: "co-bni",
      referencesExistantes: new Set(),
      contreparties: [contrepartie({ id: "w1", compteId: "co-wave", sens: "SORTIE" })],
    });
    expect(r).toMatchObject({ typeFlux: "VIREMENT_INTERNE_ENTRANT", contrepartieId: "w1" });
  });

  it("pas d'appariement hors de la fenêtre de dates, avec un autre montant, ou dans le même sens", () => {
    const l = [ligne({ montant: -c(300000) })];
    expect(reconnaitreLignesReleve(l, { ...CTX, contreparties: [contrepartie({ dateValeur: "2026-03-14" })] })[0].typeFlux).toBe("AUTRE_DEBIT");
    expect(reconnaitreLignesReleve(l, { ...CTX, contreparties: [contrepartie({ montant: c(299999) })] })[0].typeFlux).toBe("AUTRE_DEBIT");
    expect(reconnaitreLignesReleve(l, { ...CTX, contreparties: [contrepartie({ sens: "SORTIE" })] })[0].typeFlux).toBe("AUTRE_DEBIT");
  });

  it("la fenêtre de dates est réglable, bornes comprises", () => {
    const l = [ligne({ montant: -c(300000), dateValeur: "2026-03-10" })];
    expect(reconnaitreLignesReleve(l, { ...CTX, contreparties: [contrepartie({ dateValeur: "2026-03-13" })] })[0].typeFlux).toBe("VIREMENT_INTERNE_SORTANT");
    expect(reconnaitreLignesReleve(l, { ...CTX, fenetreJoursVirement: 1, contreparties: [contrepartie({ dateValeur: "2026-03-13" })] })[0].typeFlux).toBe("AUTRE_DEBIT");
  });

  it("la tolérance de montant est réglable (0 par défaut)", () => {
    const l = [ligne({ montant: -c(300000) })];
    const proche = contrepartie({ montant: c(300000) - BigInt(50) });
    expect(reconnaitreLignesReleve(l, { ...CTX, contreparties: [proche] })[0].typeFlux).toBe("AUTRE_DEBIT");
    expect(reconnaitreLignesReleve(l, { ...CTX, toleranceVirementCentimes: BigInt(100), contreparties: [proche] })[0].typeFlux).toBe("VIREMENT_INTERNE_SORTANT");
  });

  it("une contrepartie du MÊME compte est ignorée", () => {
    const r = reconnaitreLignesReleve([ligne({ montant: -c(300000) })], { ...CTX, contreparties: [contrepartie({ compteId: "co-wave" })] });
    expect(r[0].typeFlux).toBe("AUTRE_DEBIT");
    expect(r[0].signalements).toEqual([]);
  });

  it("deux candidates à égale distance de date : ambigu, rien n'est apparié, une alerte est levée", () => {
    const r = reconnaitreLignesReleve([ligne({ montant: -c(300000), dateValeur: "2026-03-10" })], {
      ...CTX,
      contreparties: [contrepartie({ id: "a", dateValeur: "2026-03-09" }), contrepartie({ id: "b", dateValeur: "2026-03-11" })],
    });
    expect(r[0].typeFlux).toBe("AUTRE_DEBIT");
    expect(r[0].signalements.map((s) => s.code)).toEqual(["VIREMENT_AMBIGU"]);
    expect(r[0].contrepartieId).toBeUndefined();
  });

  it("deux candidates à des distances différentes : la plus proche l'emporte, si personne d'autre ne la réclame", () => {
    const r = reconnaitreLignesReleve([ligne({ montant: -c(300000), dateValeur: "2026-03-10" })], {
      ...CTX,
      contreparties: [contrepartie({ id: "loin", dateValeur: "2026-03-13" }), contrepartie({ id: "proche", dateValeur: "2026-03-11" })],
    });
    expect(r[0]).toMatchObject({ typeFlux: "VIREMENT_INTERNE_SORTANT", contrepartieId: "proche" });
  });

  it("deux lignes du relevé qui réclament la même contrepartie : les deux sont ambiguës", () => {
    const r = reconnaitreLignesReleve(
      [ligne({ numeroLigne: 2, reference: "A", montant: -c(300000) }), ligne({ numeroLigne: 3, reference: "B", montant: -c(300000) })],
      { ...CTX, contreparties: [contrepartie()] }
    );
    expect(r.map((x) => x.typeFlux)).toEqual(["AUTRE_DEBIT", "AUTRE_DEBIT"]);
    expect(r.every((x) => x.signalements.some((s) => s.code === "VIREMENT_AMBIGU"))).toBe(true);
  });

  it("deux virements identiques, deux contreparties à des dates différentes : chacun trouve la sienne", () => {
    const r = reconnaitreLignesReleve(
      [ligne({ numeroLigne: 2, reference: "A", montant: -c(300000), dateValeur: "2026-03-02" }), ligne({ numeroLigne: 3, reference: "B", montant: -c(300000), dateValeur: "2026-03-20" })],
      { ...CTX, contreparties: [contrepartie({ id: "x", dateValeur: "2026-03-02" }), contrepartie({ id: "y", dateValeur: "2026-03-20" })] }
    );
    expect(r.map((x) => x.contrepartieId)).toEqual(["x", "y"]);
    expect(bilanReconnaissance(r).nbVirementsApparies).toBe(2);
  });

  it("une transaction test, un remboursement ou des frais ne sont jamais appariés à un virement", () => {
    const r = reconnaitreLignesReleve(
      [ligne({ numeroLigne: 2, reference: "A", montant: -c(300000), payeur: "TEST" }), ligne({ numeroLigne: 3, reference: "B", montant: -c(300000), typeSource: "refund" })],
      { ...CTX, contreparties: [contrepartie()] }
    );
    expect(r.map((x) => x.typeFlux)).toEqual(["TEST", "REMBOURSEMENT"]);
  });

  it("un crédit client ordinaire sans contrepartie reste un encaissement à rattacher", () => {
    expect(reconnaitreLignesReleve([ligne()], { ...CTX, contreparties: [contrepartie({ montant: c(5) })] })[0]).toMatchObject({ typeFlux: "ENCAISSEMENT", signalements: [] });
  });
});

describe("outils", () => {
  it("écart en jours : valeur absolue, passage de mois et d'année", () => {
    expect(ecartJours("2026-03-10", "2026-03-13")).toBe(3);
    expect(ecartJours("2026-03-13", "2026-03-10")).toBe(3);
    expect(ecartJours("2026-02-28", "2026-03-01")).toBe(1);
    expect(ecartJours("2025-12-31", "2026-01-01")).toBe(1);
    expect(ecartJours("2026-03-10", "2026-03-10")).toBe(0);
  });

  it("enLigneComplete : null si la référence, la date ou le montant manque", () => {
    const l: LigneReleve = { ...ligne() };
    expect(enLigneComplete(l)).not.toBeNull();
    expect(enLigneComplete({ ...l, reference: null })).toBeNull();
    expect(enLigneComplete({ ...l, dateValeur: null })).toBeNull();
    expect(enLigneComplete({ ...l, montant: null })).toBeNull();
  });

  it("bilan : décompte par type, virements appariés et alertes", () => {
    const r = reconnaitreLignesReleve(
      [
        ligne({ numeroLigne: 2, reference: "A" }),
        ligne({ numeroLigne: 3, reference: "B", montant: -c(300000) }),
        ligne({ numeroLigne: 4, reference: "C", typeSource: "refund", montant: c(10) }),
        ligne({ numeroLigne: 5, reference: "D", payeur: "TEST" }),
        ligne({ numeroLigne: 6, reference: "E", libelle: "FRAIS", montant: -c(100) }),
      ],
      { ...CTX, contreparties: [contrepartie()] }
    );
    const b = bilanReconnaissance(r);
    expect(b.nbLignes).toBe(5);
    expect(b.nbVirementsApparies).toBe(1);
    expect(b.nbAlertes).toBe(1);
    expect(b.parType).toMatchObject({ ENCAISSEMENT: 2, VIREMENT_INTERNE_SORTANT: 1, TEST: 1, FRAIS: 1, REMBOURSEMENT: 0, AUTRE_DEBIT: 0 });
  });
});

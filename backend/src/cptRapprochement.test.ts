import { describe, expect, it } from "vitest";

import {
  aideRattachementCpt,
  controlerConfirmationCpt,
  memeNomCpt,
  normaliserReferenceRapprochementCpt,
  proposerRattachementsCpt,
  refusSommesValidationCpt,
  repartirSurEcheancesCpt,
  resteARattacherCpt,
  transitionRattachementCpt,
  type EcheanceCandidateCpt,
  type EncaissementARapprocher,
} from "./cptRapprochement";

const fcfa = (n: number) => BigInt(n) * BigInt(100);

function ech(id: string, p: Partial<EcheanceCandidateCpt> = {}): EcheanceCandidateCpt {
  return {
    echeanceId: id,
    contratId: `C-${id}`,
    numPolice: `POL-${id}`,
    rang: 1,
    clientNom: "Kouassi Ama",
    partenaireId: null,
    referenceDeclaree: null,
    datePaiementDeclaree: null,
    datePrevue: "2026-03-10",
    reste: fcfa(2500),
    ...p,
  };
}

function enc(id: string, p: Partial<EncaissementARapprocher> = {}): EncaissementARapprocher {
  return { id, referenceReleve: `T_${id}0000000000`, dateValeur: "2026-03-10", montant: fcfa(2500), payeur: null, ...p };
}

describe("outils", () => {
  it("normalise une référence (casse, espaces, signes)", () => {
    expect(normaliserReferenceRapprochementCpt(" t_ab-12 34 ")).toBe("TAB1234");
    expect(normaliserReferenceRapprochementCpt(null)).toBe("");
  });
  it("reconnaît le même nom malgré l'ordre, la casse et les accents", () => {
    expect(memeNomCpt("AMA KOUASSI", "Kouassi Ama")).toBe(true);
    expect(memeNomCpt("Koné", "Kone Awa")).toBe(true);
    expect(memeNomCpt("Traoré Issa", "Kouassi Ama")).toBe(false);
    expect(memeNomCpt("", "Kouassi")).toBe(false);
  });
  it("répartit sur les échéances, la plus ancienne d'abord, sans inventer d'excédent", () => {
    const e1 = ech("a", { rang: 1, reste: fcfa(1000) });
    const e2 = ech("a2", { rang: 2, reste: fcfa(1000) });
    expect(repartirSurEcheancesCpt(fcfa(1500), [e1, e2]).map((p) => [p.echeanceId, p.montant])).toEqual([
      ["a", fcfa(1000)],
      ["a2", fcfa(500)],
    ]);
    expect(repartirSurEcheancesCpt(fcfa(5000), [e1, e2]).reduce((s, p) => s + p.montant, BigInt(0))).toBe(fcfa(2000));
  });
});

describe("méthode 1 et 2 : la référence", () => {
  it("référence exacte → preuve", () => {
    const r = proposerRattachementsCpt([enc("1", { referenceReleve: "T_ABC123XYZ789" })], [ech("a", { referenceDeclaree: "t_abc123xyz789" })]);
    expect(r.propositions).toHaveLength(1);
    expect(r.propositions[0]).toMatchObject({ methode: "REFERENCE_EXACTE", niveauPreuve: "PREUVE", numPolice: "POL-a" });
  });
  it("référence incomplète (12 premiers caractères) + même montant → preuve", () => {
    const r = proposerRattachementsCpt([enc("1", { referenceReleve: "T_ABC123XYZ789ZZ" })], [ech("a", { referenceDeclaree: "T_ABC123XYZ789" })]);
    expect(r.propositions[0]).toMatchObject({ methode: "REFERENCE_INCOMPLETE", niveauPreuve: "PREUVE" });
  });
  it("référence incomplète mais montant différent → pas de preuve", () => {
    const r = proposerRattachementsCpt(
      [enc("1", { referenceReleve: "T_ABC123XYZ789ZZ", montant: fcfa(9000) })],
      [ech("a", { referenceDeclaree: "T_ABC123XYZ789" })],
    );
    expect(r.propositions.every((p) => p.methode !== "REFERENCE_INCOMPLETE")).toBe(true);
  });
  it("un surplus de la référence exacte passe à l'échéance suivante du contrat (T3 : 50 000 puis 50 000)", () => {
    const e1 = ech("a", { rang: 1, reste: fcfa(50000), referenceDeclaree: "REFGROUPE0001" });
    const e2 = ech("a", { echeanceId: "a-2", rang: 2, reste: fcfa(50000) });
    const r = proposerRattachementsCpt([enc("1", { referenceReleve: "REFGROUPE0001", montant: fcfa(80000) })], [e1, e2]);
    expect(r.propositions.map((p) => [p.echeanceId, p.montant])).toEqual([
      ["a", fcfa(50000)],
      ["a-2", fcfa(30000)],
    ]);
  });
});

describe("méthode 3 : montant et date", () => {
  const contrat = ech("a", { datePaiementDeclaree: "2026-03-08", reste: fcfa(2500) });
  it("montant à 1 FCFA près dans la fenêtre −3 / +5 jours → déduction", () => {
    const r = proposerRattachementsCpt([enc("1", { montant: fcfa(2500) + BigInt(80), dateValeur: "2026-03-13" })], [contrat]);
    expect(r.propositions[0]).toMatchObject({ methode: "MONTANT_DATE", niveauPreuve: "DEDUCTION" });
  });
  it("hors de la fenêtre de dates : pas de déduction", () => {
    const r = proposerRattachementsCpt([enc("1", { dateValeur: "2026-03-14" })], [contrat]);
    expect(r.propositions.every((p) => p.methode !== "MONTANT_DATE")).toBe(true);
  });
  it("deux encaissements visent le même contrat : aucune déduction (un encaissement pour un contrat)", () => {
    const r = proposerRattachementsCpt([enc("1"), enc("2", { referenceReleve: "T_AUTRE000000" })], [contrat]);
    expect(r.propositions.every((p) => p.methode !== "MONTANT_DATE")).toBe(true);
  });
  it("un encaissement déjà résolu par sa référence ne bloque pas la déduction d'un autre de même montant", () => {
    const k1 = ech("a", { referenceDeclaree: "T_REFEXACT0001" });
    const k3 = ech("c", { datePaiementDeclaree: "2026-03-08" });
    const r = proposerRattachementsCpt([enc("1", { referenceReleve: "T_REFEXACT0001" }), enc("3", { referenceReleve: "T_AUTRE000000" })], [k1, k3]);
    expect(r.propositions.find((p) => p.encaissementId === "1")).toMatchObject({ methode: "REFERENCE_EXACTE", numPolice: "POL-a" });
    expect(r.propositions.find((p) => p.encaissementId === "3")).toMatchObject({ methode: "MONTANT_DATE", numPolice: "POL-c" });
  });
  it("T13 : 150 000 sans référence sur un groupe de 250 000 ayant reçu 100 000 → contrat proposé au solde exact", () => {
    const groupe = ech("g", { reste: fcfa(150000), datePaiementDeclaree: "2026-03-10", clientNom: "Groupe Santé SA" });
    const r = proposerRattachementsCpt([enc("1", { montant: fcfa(150000), referenceReleve: "" })], [groupe]);
    expect(r.propositions[0]).toMatchObject({ methode: "MONTANT_DATE", montant: fcfa(150000), numPolice: "POL-g" });
    expect(aideRattachementCpt(fcfa(150000), "Groupe Santé", [groupe, ech("x")])[0]).toMatchObject({ numPolice: "POL-g", memeNom: true });
  });
});

describe("méthode 4 : groupe d'un partenaire", () => {
  const p = { partenaireId: "P1", datePaiementDeclaree: "2026-03-09" };
  it("la somme de deux contrats du même partenaire égale l'encaissement → groupe unique", () => {
    const r = proposerRattachementsCpt(
      [enc("1", { montant: fcfa(3000), referenceReleve: "" })],
      [ech("a", { ...p, reste: fcfa(1000) }), ech("b", { ...p, reste: fcfa(2000) }), ech("c", { ...p, reste: fcfa(7000) })],
    );
    expect(r.propositions.map((x) => x.numPolice).sort()).toEqual(["POL-a", "POL-b"]);
    expect(r.propositions.every((x) => x.methode === "GROUPE" && x.groupe === "G-1")).toBe(true);
  });
  it("deux combinaisons possibles → aucune proposition de groupe", () => {
    const r = proposerRattachementsCpt(
      [enc("1", { montant: fcfa(3000), referenceReleve: "" })],
      [ech("a", { ...p, reste: fcfa(1000) }), ech("b", { ...p, reste: fcfa(2000) }), ech("c", { ...p, reste: fcfa(1500) }), ech("d", { ...p, reste: fcfa(1500) })],
    );
    expect(r.propositions.every((x) => x.methode !== "GROUPE")).toBe(true);
  });
});

describe("méthode 5 : probable", () => {
  it("même nom de payeur → à confirmer", () => {
    const r = proposerRattachementsCpt([enc("1", { payeur: "KOUASSI AMA", montant: fcfa(2400) })], [ech("a")]);
    expect(r.propositions[0]).toMatchObject({ methode: "PROBABLE", niveauPreuve: "A_CONFIRMER" });
  });
  it("montant à ±2 % et date prévue à ±45 jours → à confirmer", () => {
    const r = proposerRattachementsCpt([enc("1", { montant: fcfa(2540), dateValeur: "2026-04-20", payeur: "Inconnu" })], [ech("a", { datePrevue: "2026-03-10" })]);
    expect(r.propositions[0]).toMatchObject({ methode: "PROBABLE", montant: fcfa(2500) });
  });
  it("au-delà de 2 % ou de 45 jours : aucune proposition, l'encaissement reste à identifier", () => {
    const r = proposerRattachementsCpt([enc("1", { montant: fcfa(2600), payeur: "Inconnu" }), enc("2", { montant: fcfa(2500), dateValeur: "2026-06-01", payeur: "Inconnu" })], [ech("a")]);
    expect(r.propositions).toHaveLength(0);
    expect(r.sansProposition).toEqual(["1", "2"]);
  });
  it("jamais plus de cinq propositions probables", () => {
    const candidates = Array.from({ length: 9 }, (_, i) => ech(`k${i}`));
    const r = proposerRattachementsCpt([enc("1", { payeur: "Kouassi Ama" })], candidates);
    expect(r.propositions).toHaveLength(5);
  });
});

describe("cycle de vie d'un rattachement", () => {
  const propose = { statut: "PROPOSE" as const, niveauPreuve: "DEDUCTION" as const, recuConfirmation: null };
  it("niveau déduction : valider sans confirmation est refusé avec la raison", () => {
    const t = transitionRattachementCpt(propose, "VALIDER");
    expect(t.ok).toBe(false);
  });
  it("confirmer puis valider", () => {
    expect(transitionRattachementCpt(propose, "CONFIRMER")).toEqual({ ok: true, vers: "CONFIRME" });
    expect(transitionRattachementCpt({ ...propose, statut: "CONFIRME", recuConfirmation: "REÇU-12" }, "VALIDER")).toEqual({ ok: true, vers: "VALIDE" });
  });
  it("confirmé sans reçu : la validation reste refusée", () => {
    expect(transitionRattachementCpt({ ...propose, statut: "CONFIRME", recuConfirmation: "  " }, "VALIDER").ok).toBe(false);
  });
  it("niveau preuve : validation directe, pas de confirmation", () => {
    const preuve = { statut: "PROPOSE" as const, niveauPreuve: "PREUVE" as const, recuConfirmation: null };
    expect(transitionRattachementCpt(preuve, "VALIDER")).toEqual({ ok: true, vers: "VALIDE" });
    expect(transitionRattachementCpt(preuve, "CONFIRMER").ok).toBe(false);
  });
  it("rejet : motif obligatoire ; un rattachement validé ou rejeté ne bouge plus", () => {
    expect(transitionRattachementCpt(propose, "REJETER", " ").ok).toBe(false);
    expect(transitionRattachementCpt(propose, "REJETER", "Mauvais contrat")).toEqual({ ok: true, vers: "REJETE" });
    expect(transitionRattachementCpt({ ...propose, statut: "VALIDE" }, "REJETER", "Mauvais contrat").ok).toBe(false);
    expect(transitionRattachementCpt({ ...propose, statut: "REJETE" }, "CONFIRMER").ok).toBe(false);
  });
  it("le reçu est obligatoire à la confirmation", () => {
    expect(controlerConfirmationCpt("")).not.toBeNull();
    expect(controlerConfirmationCpt("REÇU-1")).toBeNull();
  });
});

describe("sommes à la validation et reste à rattacher", () => {
  const base = { montantRattachement: fcfa(2500), montantEncaissement: fcfa(4500), dejaValideSurEncaissement: BigInt(0), montantDuEcheance: fcfa(2500), dejaValideSurEcheance: BigInt(0) };
  it("accepte dans les plafonds, refuse au-delà de l'encaissement ou de l'échéance", () => {
    expect(refusSommesValidationCpt(base)).toBeNull();
    expect(refusSommesValidationCpt({ ...base, dejaValideSurEncaissement: fcfa(2500) })).toMatch(/encaissement/);
    expect(refusSommesValidationCpt({ ...base, dejaValideSurEcheance: fcfa(1) })).toMatch(/échéance/);
    expect(refusSommesValidationCpt({ ...base, montantRattachement: BigInt(0) })).not.toBeNull();
  });
  it("T1 : 4 500 payés = 2 500 rattachés + 2 000 « pas une prime » → soldé", () => {
    expect(resteARattacherCpt(fcfa(4500), fcfa(2500), fcfa(2000))).toEqual({ reste: BigInt(0), statut: "SOLDE" });
    expect(resteARattacherCpt(fcfa(4500), fcfa(2500), BigInt(0))).toEqual({ reste: fcfa(2000), statut: "A_RATTACHER" });
  });
});

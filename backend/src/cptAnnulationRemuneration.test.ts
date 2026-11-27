import { describe, expect, it } from "vitest";

import { raisonBlocageAnnulationCpt, validerSaisieAnnulationCpt, type OperationRemunerationCpt } from "./cptAnnulationRemuneration";

const F = (fcfa: number) => BigInt(fcfa) * BigInt(100);
const dus = new Map([
  ["h1", F(5000)],
  ["h2", F(2000)],
  ["c1", F(10000)],
]);
const operation = (id: string, creeAt: string, affectations: [string, number][], p: Partial<OperationRemunerationCpt> = {}): OperationRemunerationCpt => ({
  type: "REGLEMENT",
  id,
  reference: id,
  montant: F(affectations.reduce((s, [, m]) => s + Math.max(0, m), 0)),
  auteurId: "rfcrh",
  creeAt,
  annulee: false,
  affectations: affectations.map(([ligneId, m]) => ({ ligneId, montant: F(m) })),
  ...p,
});
const raison = (o: OperationRemunerationCpt, operations: OperationRemunerationCpt[], userId = "direction") => raisonBlocageAnnulationCpt({ operation: o, operations, dus, userId });

const r1 = operation("CPR-1", "2026-03-01T10:00:00.000Z", [
  ["h1", 5000],
  ["h2", 2000],
]);
const compensation = operation("comp", "2026-03-05T10:00:00.000Z", [
  ["h2", -1000],
  ["c1", 1000],
], { type: "COMPENSATION", reference: "" });

describe("Q22 — annulation d'un règlement ou d'une compensation", () => {
  it("possible pour une autre personne que l'auteur ; jamais pour l'auteur", () => {
    expect(raison(r1, [r1])).toBeNull();
    expect(raison(r1, [r1], "rfcrh")).toBe("Vous avez saisi cette opération : une autre personne doit l'annuler.");
  });

  it("une opération n'est annulée qu'une fois", () => {
    expect(raison({ ...r1, annulee: true }, [r1])).toBe("Cette opération est déjà annulée.");
  });

  it("règlement refusé tant qu'une compensation active reprend des montants qu'il a payés, même si le payé restait positif", () => {
    const autre = operation("CPR-0", "2026-02-01T10:00:00.000Z", [["h2", 1000]]);
    const dusLarges = new Map([...dus, ["h2", F(3000)]]);
    expect(raisonBlocageAnnulationCpt({ operation: r1, operations: [autre, r1, compensation], dus: dusLarges, userId: "direction" })).toMatch(/^Annulez d'abord la compensation du 05\/03\/2026 \(1\s000 FCFA\)/);
  });

  it("la compensation annulée, le règlement redevient annulable", () => {
    expect(raison(r1, [r1, { ...compensation, annulee: true }])).toBeNull();
    expect(raison(compensation, [r1, compensation])).toBeNull();
  });

  it("une compensation antérieure au règlement ne s'appuie pas sur lui", () => {
    const avant = operation("avant", "2026-02-01T10:00:00.000Z", [["h2", -1000], ["c1", 1000]], { type: "COMPENSATION", reference: "" });
    const base = operation("CPR-0", "2026-01-01T10:00:00.000Z", [["h2", 1000]]);
    const apres = operation("CPR-2", "2026-03-01T10:00:00.000Z", [["h2", 1000]]);
    expect(raison(apres, [base, avant, apres])).toBeNull();
  });

  it("jamais un payé négatif", () => {
    // Reprise sur h2 antérieure (autre origine) : sans CPR-2, h2 vaudrait -1 000.
    const reprise = operation("avant", "2026-02-01T10:00:00.000Z", [["h2", -1000], ["c1", 1000]], { type: "COMPENSATION", reference: "" });
    const apres = operation("CPR-2", "2026-03-01T10:00:00.000Z", [["h2", 1000]]);
    expect(raison(apres, [reprise, apres])).toBe("Annulation impossible : le payé d'une échéance deviendrait négatif.");
  });

  it("annuler une compensation n'est pas possible si une échéance dont elle avait repris l'avance a été repayée depuis", () => {
    const repaye = operation("CPR-3", "2026-03-10T10:00:00.000Z", [["h2", 1000]]);
    expect(raison(compensation, [r1, compensation, repaye])).toBe("Annulez d'abord le règlement CPR-3 : sinon une échéance serait payée au-delà de son dû.");
    expect(raison(compensation, [r1, compensation, { ...repaye, annulee: true }])).toBeNull();
  });

  it("annuler une compensation dont l'imputation a été reprise par une autre : l'autre d'abord", () => {
    const suivante = operation("comp2", "2026-03-08T10:00:00.000Z", [["c1", -1000], ["h2", 1000]], { type: "COMPENSATION", reference: "" });
    expect(raison(compensation, [r1, compensation, suivante])).toMatch(/^Annulez d'abord la compensation du 08\/03\/2026/);
  });
});

describe("Q22 — saisie d'une annulation", () => {
  const base = { type: "REGLEMENT", operationId: "x", motif: "Montant saisi par erreur", sansVersement: "true" };
  const erreurs = (s: Record<string, unknown>) => {
    const r = validerSaisieAnnulationCpt(s);
    return r.ok ? {} : r.erreurs;
  };

  it("motif de 10 caractères au moins", () => {
    expect(erreurs({ ...base, motif: "erreur" }).motif).toBeDefined();
    expect(erreurs(base)).toEqual({});
  });

  it("un règlement exige la case « aucun versement n'a eu lieu » ; une compensation non (aucun argent ne circule)", () => {
    expect(erreurs({ ...base, sansVersement: "" }).sansVersement).toMatch(/Aucun versement n'a eu lieu/);
    expect(erreurs({ ...base, type: "COMPENSATION", sansVersement: undefined })).toEqual({});
    const r = validerSaisieAnnulationCpt({ ...base, type: "COMPENSATION" });
    expect(r.ok && r.valeur.sansVersement).toBe(false);
  });

  it("type inconnu ou opération absente : refusé ; pièce Odoo facultative de 60 caractères au plus", () => {
    expect(erreurs({ ...base, type: "AUTRE" }).operationId).toBeDefined();
    expect(erreurs({ ...base, operationId: " " }).operationId).toBeDefined();
    expect(erreurs({ ...base, pieceOdoo: "x".repeat(61) }).pieceOdoo).toBeDefined();
  });
});

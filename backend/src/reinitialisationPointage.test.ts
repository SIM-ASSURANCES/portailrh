import { describe, expect, it } from "vitest";
import {
  CONFIRMATION_MISE_EN_SERVICE_POINTAGE,
  CONFIRMATION_REINITIALISATION_POINTAGE,
  PERMISSION_REINITIALISER_POINTAGE,
  calculerEmpreintePointage,
  decompterJeuxPointage,
  type JeuxPointage,
} from "./reinitialisationPointage";
import { CONFIRMATION_REINITIALISATION } from "./reinitialisation";
import { PERMISSIONS_DECISION_NON_DELEGABLES } from "./circuitDemande";

const jeux = (surcharge: Partial<Record<keyof JeuxPointage, unknown[]>> = {}) =>
  ({
    correctionPointage: [],
    justificationPointage: [],
    pointage: [{ id: "p1" }],
    absence: [{ id: "a1" }],
    plageAbsenceAutorisee: [],
    notificationPointage: [],
    historiquePointage: [],
    executionTache: [],
    journalTechnique: [],
    ...surcharge,
  }) as unknown as JeuxPointage;

describe("empreinte de la purge du Pointage", () => {
  it("stable pour les mêmes données, différente dès qu'une ligne métier change", () => {
    expect(calculerEmpreintePointage(jeux())).toBe(calculerEmpreintePointage(jeux()));
    expect(calculerEmpreintePointage(jeux())).toMatch(/^[0-9a-f]{64}$/);
    expect(calculerEmpreintePointage(jeux())).not.toBe(calculerEmpreintePointage(jeux({ pointage: [{ id: "p1" }, { id: "p2" }] })));
    expect(calculerEmpreintePointage(jeux())).not.toBe(calculerEmpreintePointage(jeux({ absence: [] })));
  });

  it("ExecutionTache et JournalTechnique (réécrites en continu) sont HORS empreinte", () => {
    const base = calculerEmpreintePointage(jeux());
    expect(calculerEmpreintePointage(jeux({ executionTache: [{ id: "e1" }] }))).toBe(base);
    expect(calculerEmpreintePointage(jeux({ journalTechnique: [{ id: "j1" }, { id: "j2" }] }))).toBe(base);
  });

  it("le décompte les contient pourtant (elles sont purgées)", () => {
    expect(decompterJeuxPointage(jeux({ executionTache: [{}, {}], journalTechnique: [{}] }))).toMatchObject({
      pointage: 1,
      absence: 1,
      executionTache: 2,
      journalTechnique: 1,
    });
  });
});

describe("mots de confirmation et permission", () => {
  it("mots exacts, distincts de celui de la réinitialisation globale", () => {
    expect(CONFIRMATION_REINITIALISATION_POINTAGE).toBe("REINITIALISER-POINTAGE");
    expect(CONFIRMATION_MISE_EN_SERVICE_POINTAGE).toBe("METTRE-EN-SERVICE-POINTAGE");
    expect(CONFIRMATION_REINITIALISATION_POINTAGE).not.toBe(CONFIRMATION_REINITIALISATION);
  });
  it("la permission est dédiée et jamais délégable", () => {
    expect(PERMISSION_REINITIALISER_POINTAGE).toBe("pointage.reinitialiser");
    expect(PERMISSIONS_DECISION_NON_DELEGABLES).toContain(PERMISSION_REINITIALISER_POINTAGE);
  });
});

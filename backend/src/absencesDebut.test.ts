import { describe, expect, it } from "vitest";
import { dateDebutAbsences } from "./absencesDebut";

// Dates locales : aucune dépendance au fuseau de la machine de test.
const d = (jour: number, h = 0, m = 0, mois = 9) => new Date(2026, mois, jour, h, m, 0);
const SYSTEM_START = d(5, 0, 0, 9); // 2026-10-05

describe("dateDebutAbsences", () => {
  it("sans purge ni mise en service : SYSTEM_START_DATE à 00:00", () => {
    expect(dateDebutAbsences({ systemStartDate: d(5, 14, 30) })).toEqual(d(5));
  });

  it("après une purge : le LENDEMAIN du jour de la purge, aucune absence ne peut être recréée avant", () => {
    expect(dateDebutAbsences({ systemStartDate: SYSTEM_START, dernierePurge: d(14, 10, 30) })).toEqual(d(15));
    // Une purge en toute fin de journée vaut toujours le lendemain.
    expect(dateDebutAbsences({ systemStartDate: SYSTEM_START, dernierePurge: d(14, 23, 59) })).toEqual(d(15));
  });

  it("la plus récente l'emporte : SYSTEM_START_DATE postérieure à la purge", () => {
    expect(dateDebutAbsences({ systemStartDate: d(20), dernierePurge: d(14, 10) })).toEqual(d(20));
  });

  it("une purge ancienne ne recule jamais SYSTEM_START_DATE", () => {
    expect(dateDebutAbsences({ systemStartDate: d(10), dernierePurge: d(2, 8) })).toEqual(d(10));
  });

  it("mise en service : le jour même est inclus (rien n'y a été supprimé)", () => {
    expect(dateDebutAbsences({ systemStartDate: SYSTEM_START, miseEnService: d(16, 9) })).toEqual(d(16));
  });

  it("purge puis mise en service : la plus récente des deux dates", () => {
    expect(dateDebutAbsences({ systemStartDate: SYSTEM_START, dernierePurge: d(14, 10), miseEnService: d(20, 8) })).toEqual(d(20));
    expect(dateDebutAbsences({ systemStartDate: SYSTEM_START, dernierePurge: d(14, 10), miseEnService: d(14, 18) })).toEqual(d(15));
  });

  it("passage d'un mois à l'autre et d'une année à l'autre", () => {
    expect(dateDebutAbsences({ systemStartDate: SYSTEM_START, dernierePurge: d(31, 12, 0, 9) })).toEqual(d(1, 0, 0, 10));
    expect(dateDebutAbsences({ systemStartDate: SYSTEM_START, dernierePurge: new Date(2026, 11, 31, 9) })).toEqual(new Date(2027, 0, 1));
  });

  it("valeurs nulles acceptées (aucune purge, aucune mise en service)", () => {
    expect(dateDebutAbsences({ systemStartDate: SYSTEM_START, dernierePurge: null, miseEnService: null })).toEqual(d(5));
  });
});

import { describe, expect, it } from "vitest";

import {
  ajouterJours,
  colonneDateDepuisJourCivil,
  decompterJours,
  estJourOuvre,
  formatJourCivil,
  jourCivilDepuisColonneDate,
  listerJours,
  parseJourCivil,
  periodesSeChevauchent,
  premierChevauchement,
} from "./congesCalcul";

// Calendrier d'octobre 2026 : lundi 12, mardi 13, mercredi 14, jeudi 15, vendredi 16, samedi 17, dimanche 18, lundi 19.
const LUN = "2026-10-12";
const MER = "2026-10-14";
const VEN = "2026-10-16";
const SAM = "2026-10-17";
const DIM = "2026-10-18";
const LUN_SUIVANT = "2026-10-19";

describe("jours civils", () => {
  it("le calendrier de référence des tests est le bon (lundi 12 octobre 2026)", () => {
    expect(parseJourCivil(LUN)?.getDay()).toBe(1);
    expect(parseJourCivil(SAM)?.getDay()).toBe(6);
    expect(parseJourCivil(DIM)?.getDay()).toBe(0);
  });

  it("refuse un texte qui n'est pas un jour calendaire", () => {
    for (const mauvais of ["2026-02-30", "2026-13-01", "2026-1-1", "abc", "", "2026-10-12T00:00"]) {
      expect(parseJourCivil(mauvais), mauvais).toBeNull();
    }
    expect(parseJourCivil("2028-02-29")).not.toBeNull();
    expect(parseJourCivil("2026-02-29")).toBeNull();
  });

  it("aller-retour texte / date locale / colonne DATE", () => {
    expect(formatJourCivil(parseJourCivil(LUN)!)).toBe(LUN);
    expect(jourCivilDepuisColonneDate(colonneDateDepuisJourCivil(LUN))).toBe(LUN);
    expect(ajouterJours("2026-12-31", 1)).toBe("2027-01-01");
    expect(ajouterJours("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("liste les jours bornes comprises, vide si la fin précède le début", () => {
    expect(listerJours(LUN, MER)).toEqual([LUN, "2026-10-13", MER]);
    expect(listerJours(LUN, LUN)).toEqual([LUN]);
    expect(listerJours(MER, LUN)).toEqual([]);
  });

  it("refuse une période démesurée", () => {
    expect(() => listerJours("2026-01-01", "2028-01-01")).toThrow();
  });
});

describe("jours ouvrés — lundi à vendredi, hors jours fériés (R4)", () => {
  it("lundi à vendredi : 5 jours ouvrés, aucun week-end", () => {
    const d = decompterJours({ debut: LUN, fin: VEN, joursFeries: [] });
    expect(d.nbJoursOuvres).toBe(5);
    expect(d.jours).toHaveLength(5);
  });

  it("le week-end n'est jamais ouvré : lundi à lundi = 6 jours ouvrés sur 8", () => {
    const d = decompterJours({ debut: LUN, fin: LUN_SUIVANT, joursFeries: [] });
    expect(d.jours).toHaveLength(8);
    expect(d.nbJoursOuvres).toBe(6);
    expect(d.joursOuvres).not.toContain(SAM);
    expect(d.joursOuvres).not.toContain(DIM);
  });

  it("un jour férié en semaine n'est pas ouvré et figure dans les jours fériés inclus", () => {
    const d = decompterJours({ debut: LUN, fin: VEN, joursFeries: [MER] });
    expect(d.nbJoursOuvres).toBe(4);
    expect(d.joursFeriesInclus).toEqual([MER]);
    expect(estJourOuvre(MER, [MER])).toBe(false);
    expect(estJourOuvre(MER)).toBe(true);
  });

  it("un jour férié un dimanche ne compte pas deux fois et n'est pas listé", () => {
    const d = decompterJours({ debut: SAM, fin: DIM, joursFeries: [DIM] });
    expect(d.nbJoursOuvres).toBe(0);
    expect(d.joursFeriesInclus).toEqual([]);
  });

  it("une période qui finit avant son début est vide", () => {
    expect(decompterJours({ debut: VEN, fin: LUN, joursFeries: [] }).nbJoursOuvres).toBe(0);
  });
});

describe("chevauchement", () => {
  it("bornes comprises : un congé qui finit le jour où l'autre commence se recouvre", () => {
    expect(periodesSeChevauchent({ debut: LUN, fin: MER }, { debut: MER, fin: VEN })).toBe(true);
  });

  it("périodes qui se suivent sans se toucher : pas de chevauchement", () => {
    expect(periodesSeChevauchent({ debut: LUN, fin: MER }, { debut: "2026-10-15", fin: VEN })).toBe(false);
  });

  it("une période contenue dans une autre se recouvre, dans les deux sens", () => {
    expect(periodesSeChevauchent({ debut: LUN, fin: LUN_SUIVANT }, { debut: MER, fin: MER })).toBe(true);
    expect(periodesSeChevauchent({ debut: MER, fin: MER }, { debut: LUN, fin: LUN_SUIVANT })).toBe(true);
  });

  it("la demande en cours de modification ne se chevauche pas elle-même", () => {
    const existantes = [{ id: "a", debut: LUN, fin: VEN }];
    expect(premierChevauchement({ id: "a", debut: LUN, fin: MER }, existantes)).toBeNull();
    expect(premierChevauchement({ debut: LUN, fin: MER }, existantes)).toEqual(existantes[0]);
  });
});

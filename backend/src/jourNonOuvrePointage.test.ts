import { describe, expect, it } from "vitest";

import {
  HORAIRES_PAR_DEFAUT,
  choisirModeDepart,
  MESSAGE_JOURNEE_TERMINEE,
  estJourNonOuvre,
  formatHeureLocale,
  heureDepartPossible,
  refusArriveeHoraire,
  reglesPointage,
} from "./pointage-utils";

// Pointage V2, lot 3 bis : jour non ouvré, règles de pointage, acceptation de l'arrivée, départ possible.
// Heures locales, comme le module. 2026-10-09 = vendredi, 2026-10-10 = samedi, 2026-10-11 = dimanche.
const h = (jour: number, heure: string) => {
  const [hh, mm] = heure.split(":").map(Number);
  return new Date(2026, 9, jour, hh, mm, 0, 0);
};
const VENDREDI = 9;
const SAMEDI = 10;
const DIMANCHE = 11;
const FERIE = [new Date(2026, 9, VENDREDI)];

describe("estJourNonOuvre", () => {
  it("samedi et dimanche : non ouvrés", () => {
    expect(estJourNonOuvre(h(SAMEDI, "09:00"))).toBe(true);
    expect(estJourNonOuvre(h(DIMANCHE, "09:00"))).toBe(true);
  });
  it("jour férié enregistré : non ouvré ; même jour sans férié : ouvré", () => {
    expect(estJourNonOuvre(h(VENDREDI, "09:00"), FERIE)).toBe(true);
    expect(estJourNonOuvre(h(VENDREDI, "09:00"))).toBe(false);
  });
  it("un férié d'un autre jour ne compte pas", () => {
    expect(estJourNonOuvre(h(8, "09:00"), FERIE)).toBe(false);
  });
});

describe("reglesPointage", () => {
  const AUCUN = { estRetard: false, minutesRetard: null, estDepartAnticipe: false };

  it("samedi : arrivée à 09:00 sans retard, départ à 11:00 sans départ anticipé", () => {
    expect(reglesPointage("ARRIVEE", h(SAMEDI, "09:00"), HORAIRES_PAR_DEFAUT, [], true)).toEqual(AUCUN);
    expect(reglesPointage("DEPART", h(SAMEDI, "11:00"), HORAIRES_PAR_DEFAUT, [], true)).toEqual(AUCUN);
  });

  it("jour férié : idem", () => {
    const jourNonOuvre = estJourNonOuvre(h(VENDREDI, "10:00"), FERIE);
    expect(reglesPointage("ARRIVEE", h(VENDREDI, "10:00"), HORAIRES_PAR_DEFAUT, [], jourNonOuvre)).toEqual(AUCUN);
    expect(reglesPointage("DEPART", h(VENDREDI, "12:00"), HORAIRES_PAR_DEFAUT, [], jourNonOuvre)).toEqual(AUCUN);
  });

  it("jour ouvré : retard de 10 min à 08:10, à l'heure à 08:00, départ anticipé à 16:00", () => {
    expect(reglesPointage("ARRIVEE", h(VENDREDI, "08:10"), HORAIRES_PAR_DEFAUT, [], false)).toEqual({
      estRetard: true,
      minutesRetard: 10,
      estDepartAnticipe: false,
    });
    expect(reglesPointage("ARRIVEE", h(VENDREDI, "08:00"), HORAIRES_PAR_DEFAUT, [], false)).toEqual(AUCUN);
    expect(reglesPointage("DEPART", h(VENDREDI, "16:00"), HORAIRES_PAR_DEFAUT, [], false)).toEqual({
      estRetard: false,
      minutesRetard: null,
      estDepartAnticipe: true,
    });
    expect(reglesPointage("DEPART", h(VENDREDI, "16:45"), HORAIRES_PAR_DEFAUT, [], false)).toEqual(AUCUN);
  });

  it("jour ouvré : permission 16:00-16:45, départ à 16:00 non anticipé (règle du lot 3 conservée)", () => {
    const plages = [{ heureDebut: "16:00", heureFin: "16:45" }];
    expect(reglesPointage("DEPART", h(VENDREDI, "16:00"), HORAIRES_PAR_DEFAUT, plages, false).estDepartAnticipe).toBe(false);
  });
});

describe("refusArriveeHoraire (présence exceptionnelle)", () => {
  it("jour ouvré : arrivée refusée à 16:45 et après, acceptée à 16:44", () => {
    expect(refusArriveeHoraire(h(VENDREDI, "16:44"), HORAIRES_PAR_DEFAUT, false)).toBeNull();
    expect(refusArriveeHoraire(h(VENDREDI, "16:45"), HORAIRES_PAR_DEFAUT, false)).toBe(MESSAGE_JOURNEE_TERMINEE);
    expect(refusArriveeHoraire(h(VENDREDI, "18:00"), HORAIRES_PAR_DEFAUT, false)).toBe(MESSAGE_JOURNEE_TERMINEE);
  });
  it("samedi ou jour férié : arrivée acceptée à toute heure", () => {
    expect(refusArriveeHoraire(h(SAMEDI, "18:00"), HORAIRES_PAR_DEFAUT, true)).toBeNull();
    expect(refusArriveeHoraire(h(VENDREDI, "17:30"), HORAIRES_PAR_DEFAUT, estJourNonOuvre(h(VENDREDI, "17:30"), FERIE))).toBeNull();
  });
});

describe("heureDepartPossible", () => {
  it("arrivée + 30 minutes", () => {
    expect(heureDepartPossible(h(VENDREDI, "16:30")).getTime()).toBe(h(VENDREDI, "17:00").getTime());
    expect(formatHeureLocale(heureDepartPossible(h(VENDREDI, "08:05")))).toBe("08:35");
  });
});

describe("choisirModeDepart (arrivée déjà pointée)", () => {
  it("jour non ouvré, arrivée de plus de 30 min : en poste, jamais AUTO_DEPART, à toute heure", () => {
    for (const heure of ["10:00", "16:45", "18:00"]) {
      expect(choisirModeDepart(h(SAMEDI, "09:00"), h(SAMEDI, heure), HORAIRES_PAR_DEFAUT, [], true)).toEqual({
        mode: "EN_POSTE",
        departPossibleA: null,
      });
    }
    const ferie = estJourNonOuvre(h(VENDREDI, "18:00"), FERIE);
    expect(choisirModeDepart(h(VENDREDI, "08:00"), h(VENDREDI, "18:00"), HORAIRES_PAR_DEFAUT, [], ferie).mode).toBe("EN_POSTE");
  });

  it("jour ouvré après 16:45 : AUTO_DEPART inchangé ; avant 16:45 : en poste (départ anticipé à confirmer)", () => {
    expect(choisirModeDepart(h(VENDREDI, "08:00"), h(VENDREDI, "16:45"), HORAIRES_PAR_DEFAUT, [], false)).toEqual({
      mode: "AUTO_DEPART",
      departPossibleA: null,
    });
    expect(choisirModeDepart(h(VENDREDI, "08:00"), h(VENDREDI, "16:00"), HORAIRES_PAR_DEFAUT, [], false).mode).toBe("EN_POSTE");
  });

  it("moins de 30 min après l'arrivée : en poste avec l'heure de départ possible, même après 16:45", () => {
    const choix = choisirModeDepart(h(VENDREDI, "16:30"), h(VENDREDI, "16:50"), HORAIRES_PAR_DEFAUT, [], false);
    expect(choix.mode).toBe("EN_POSTE");
    expect(choix.departPossibleA?.getTime()).toBe(h(VENDREDI, "17:00").getTime());
  });
});

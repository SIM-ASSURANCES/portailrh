import { describe, expect, it } from "vitest";

import {
  checkLateStatus,
  departTropTot,
  estDepartAnticipe,
  heureReferenceArriveeMinutes,
  heureReferenceDepartMinutes,
  horairesPointage,
  journeeCouverteParAbsence,
} from "./pointage-utils";

const HORAIRES = { heureDebutMatin: "07:45", heureFinApresMidi: "16:45" };

describe("journeeCouverteParAbsence", () => {
  it("aucune plage : la journée n'est pas couverte", () => {
    expect(journeeCouverteParAbsence([], HORAIRES)).toBe(false);
  });

  it("congé sur toute la journée : couverte", () => {
    expect(journeeCouverteParAbsence([{ heureDebut: "00:00", heureFin: "23:59" }], HORAIRES)).toBe(true);
    expect(journeeCouverteParAbsence([{ heureDebut: "07:45", heureFin: "16:45" }], HORAIRES)).toBe(true);
  });

  it("permission d'une demi-journée : non couverte", () => {
    expect(journeeCouverteParAbsence([{ heureDebut: "07:45", heureFin: "12:00" }], HORAIRES)).toBe(false);
  });

  it("deux plages contiguës (matin + après-midi) : couverte", () => {
    const plages = [
      { heureDebut: "13:00", heureFin: "17:00" },
      { heureDebut: "07:30", heureFin: "13:00" },
    ];
    expect(journeeCouverteParAbsence(plages, HORAIRES)).toBe(true);
  });

  it("deux plages avec un trou : non couverte", () => {
    const plages = [
      { heureDebut: "07:30", heureFin: "12:00" },
      { heureDebut: "13:00", heureFin: "17:00" },
    ];
    expect(journeeCouverteParAbsence(plages, HORAIRES)).toBe(false);
  });

  it("plage incohérente (fin avant début) : ignorée", () => {
    expect(journeeCouverteParAbsence([{ heureDebut: "17:00", heureFin: "07:00" }], HORAIRES)).toBe(false);
  });
});

describe("heureReferenceArriveeMinutes", () => {
  it("sans plage : l'heure de début du matin", () => {
    expect(heureReferenceArriveeMinutes(HORAIRES)).toBe(7 * 60 + 45);
  });

  it("permission du matin : la référence passe à la fin de la permission", () => {
    expect(heureReferenceArriveeMinutes(HORAIRES, [{ heureDebut: "07:45", heureFin: "10:00" }])).toBe(10 * 60);
  });

  it("plage qui ne couvre pas le début : la référence ne bouge pas", () => {
    expect(heureReferenceArriveeMinutes(HORAIRES, [{ heureDebut: "14:00", heureFin: "16:00" }])).toBe(7 * 60 + 45);
  });

  it("plages enchaînées depuis le début : la référence va jusqu'à la fin de la dernière", () => {
    const plages = [
      { heureDebut: "09:00", heureFin: "11:00" },
      { heureDebut: "07:00", heureFin: "09:00" },
    ];
    expect(heureReferenceArriveeMinutes(HORAIRES, plages)).toBe(11 * 60);
  });
});

/** Date locale du jour à l'heure donnée (le module calcule en heure locale, comme `getHours()`). */
function a(hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(2026, 9, 12);
  d.setHours(h, m, 0, 0);
  return d;
}

const CONFIG = { ...HORAIRES, toleranceRetardMinutes: 15 };

describe("checkLateStatus (lot 3 : une seule règle de retard)", () => {
  it("07:45 et 08:00 (tolérance incluse) : à l'heure", () => {
    expect(checkLateStatus(a("07:45"), CONFIG)).toEqual({ estRetard: false, minutesRetard: 0 });
    expect(checkLateStatus(a("07:58"), CONFIG)).toEqual({ estRetard: false, minutesRetard: 0 });
    expect(checkLateStatus(a("08:00"), CONFIG)).toEqual({ estRetard: false, minutesRetard: 0 });
  });

  it("au-delà de la tolérance, le retard se compte depuis la fin de la tolérance (heure de début + marge)", () => {
    expect(checkLateStatus(a("08:01"), CONFIG)).toEqual({ estRetard: true, minutesRetard: 1 });
    expect(checkLateStatus(a("08:10"), CONFIG)).toEqual({ estRetard: true, minutesRetard: 10 });
  });

  it("tolérance 0 : en retard dès 07:46", () => {
    const sansTolerance = { ...CONFIG, toleranceRetardMinutes: 0 };
    expect(checkLateStatus(a("07:45"), sansTolerance).estRetard).toBe(false);
    expect(checkLateStatus(a("07:46"), sansTolerance)).toEqual({ estRetard: true, minutesRetard: 1 });
  });

  it("permission 07:45-10:00 : référence repoussée à 10:00", () => {
    const plages = [{ heureDebut: "07:45", heureFin: "10:00" }];
    expect(checkLateStatus(a("10:10"), CONFIG, plages).estRetard).toBe(false);
    expect(checkLateStatus(a("10:20"), CONFIG, plages)).toEqual({ estRetard: true, minutesRetard: 5 });
  });
});

describe("heureReferenceDepartMinutes / estDepartAnticipe", () => {
  it("sans plage : 16:45", () => {
    expect(heureReferenceDepartMinutes(HORAIRES)).toBe(16 * 60 + 45);
  });

  it("départ à 16:00 : anticipé ; à 16:45 : non", () => {
    expect(estDepartAnticipe(a("16:00"), CONFIG)).toBe(true);
    expect(estDepartAnticipe(a("16:45"), CONFIG)).toBe(false);
    expect(estDepartAnticipe(a("17:30"), CONFIG)).toBe(false);
  });

  it("permission 16:00-16:45 : départ à 16:00 non anticipé, à 15:59 anticipé", () => {
    const plages = [{ heureDebut: "16:00", heureFin: "16:45" }];
    expect(heureReferenceDepartMinutes(HORAIRES, plages)).toBe(16 * 60);
    expect(estDepartAnticipe(a("16:00"), CONFIG, plages)).toBe(false);
    expect(estDepartAnticipe(a("15:59"), CONFIG, plages)).toBe(true);
  });

  it("une permission du matin n'avance pas l'heure de départ", () => {
    expect(heureReferenceDepartMinutes(HORAIRES, [{ heureDebut: "07:45", heureFin: "10:00" }])).toBe(16 * 60 + 45);
  });

  it("plages contiguës couvrant la fin : ramenée au début de la première", () => {
    const plages = [
      { heureDebut: "15:00", heureFin: "16:00" },
      { heureDebut: "16:00", heureFin: "17:00" },
    ];
    expect(heureReferenceDepartMinutes(HORAIRES, plages)).toBe(15 * 60);
  });
});

describe("departTropTot", () => {
  it("refusé à 29 min, accepté à 30 min", () => {
    expect(departTropTot(a("08:00"), a("08:29"))).toBe(true);
    expect(departTropTot(a("08:00"), a("08:30"))).toBe(false);
  });
});

describe("horairesPointage", () => {
  it("sans paramétrage : valeurs par défaut", () => {
    expect(horairesPointage(null)).toEqual({
      heureDebutMatin: "07:45",
      heureFinApresMidi: "16:45",
      toleranceRetardMinutes: 15,
    });
  });

  it("tolérance 0 conservée (jamais remplacée par le défaut)", () => {
    expect(horairesPointage({ toleranceRetardMinutes: 0 }).toleranceRetardMinutes).toBe(0);
  });
});

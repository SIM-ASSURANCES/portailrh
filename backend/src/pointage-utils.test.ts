import { describe, expect, it } from "vitest";

import { heureReferenceArriveeMinutes, journeeCouverteParAbsence } from "./pointage-utils";

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

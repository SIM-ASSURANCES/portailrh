import { describe, expect, it } from "vitest";
import { etatJourMembre, periodeEquipe, type SourceEtatJour } from "./equipe";

const base: SourceEtatJour = {
  aArrive: false,
  estRetard: false,
  minutesRetard: null,
  departAnticipe: false,
  absenceAutorisee: false,
  absent: false,
  jourNonOuvre: false,
};

describe("etatJourMembre", () => {
  it("à l'heure", () => {
    expect(etatJourMembre({ ...base, aArrive: true }).code).toBe("A_L_HEURE");
  });
  it("en retard avec les minutes", () => {
    expect(etatJourMembre({ ...base, aArrive: true, estRetard: true, minutesRetard: 25 })).toEqual({ code: "EN_RETARD", libelle: "En retard · 25 min" });
  });
  it("parti en avance prime sur le retard", () => {
    expect(etatJourMembre({ ...base, aArrive: true, estRetard: true, minutesRetard: 25, departAnticipe: true }).code).toBe("PARTI_EN_AVANCE");
  });
  it("sans arrivée : absence autorisée, absent, jour non ouvré, pas encore pointé (dans cet ordre)", () => {
    expect(etatJourMembre({ ...base, absenceAutorisee: true, absent: true }).code).toBe("ABSENCE_AUTORISEE");
    // T08 : un congé validé ou en attente s'affiche comme tel ; un jour seulement protégé reste « absence autorisée ».
    expect(etatJourMembre({ ...base, absenceAutorisee: true, etatConge: "EN_CONGE" })).toEqual({ code: "EN_CONGE", libelle: "En congé" });
    expect(etatJourMembre({ ...base, absenceAutorisee: true, etatConge: "EN_ATTENTE" }).code).toBe("CONGE_EN_ATTENTE");
    expect(etatJourMembre({ ...base, absenceAutorisee: true, etatConge: "PROTEGE" }).code).toBe("ABSENCE_AUTORISEE");
    // Une arrivée pointée prime toujours, même un jour de congé (le signal « pointé pendant un congé » est à part).
    expect(etatJourMembre({ ...base, aArrive: true, absenceAutorisee: false, etatConge: "EN_CONGE" }).code).toBe("A_L_HEURE");
    expect(etatJourMembre({ ...base, absent: true, jourNonOuvre: true }).code).toBe("ABSENT");
    expect(etatJourMembre({ ...base, jourNonOuvre: true }).code).toBe("NON_OUVRE");
    expect(etatJourMembre(base).code).toBe("PAS_ENCORE_POINTE");
  });
  it("une arrivée pointée prime sur une absence enregistrée (présent malgré tout)", () => {
    expect(etatJourMembre({ ...base, aArrive: true, absent: true }).code).toBe("A_L_HEURE");
  });
});

describe("periodeEquipe", () => {
  const now = new Date(2026, 9, 14);
  it("par défaut : le mois en cours jusqu'à aujourd'hui", () => {
    expect(periodeEquipe(undefined, undefined, now)).toEqual({ du: "2026-10-01", au: "2026-10-14" });
  });
  it("valeurs valides conservées, invalides ignorées, bornes remises dans l'ordre", () => {
    expect(periodeEquipe("2026-09-01", "2026-09-30", now)).toEqual({ du: "2026-09-01", au: "2026-09-30" });
    // Début invalide : repli sur le 1er du mois (2026-10-01), puis bornes remises dans l'ordre.
    expect(periodeEquipe("pas-une-date", "2026-09-30", now)).toEqual({ du: "2026-09-30", au: "2026-10-01" });
    expect(periodeEquipe("2026-09-30", "2026-09-01", now)).toEqual({ du: "2026-09-01", au: "2026-09-30" });
  });
});

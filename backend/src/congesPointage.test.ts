import { describe, expect, it } from "vitest";
import { etatCongeDuJour, etatCongePlage, libelleAbsenceAutorisee, syntheseCongesPeriode, type PlageAbsenceLue } from "./congesPointage";

const jour = (j: string) => {
  const [a, m, d] = j.split("-").map(Number);
  return new Date(a, m - 1, d);
};
const plage = (j: string, over: Partial<PlageAbsenceLue> = {}): PlageAbsenceLue => ({
  date: jour(j),
  source: "CONGE",
  heureDebut: "00:00",
  heureFin: "23:59",
  provisoire: false,
  demandeConge: { statut: "VALIDEE", reference: "CNG-202610-0001" },
  ...over,
});

describe("état d'une plage de congé", () => {
  it("validée : en congé ; en attente : en attente ; refusée ou annulée et provisoire : protégé", () => {
    expect(etatCongePlage(plage("2026-10-19"))).toBe("EN_CONGE");
    expect(etatCongePlage(plage("2026-10-19", { provisoire: true, demandeConge: { statut: "EN_ATTENTE_RH", reference: "x" } }))).toBe("EN_ATTENTE");
    expect(etatCongePlage(plage("2026-10-19", { provisoire: true, demandeConge: { statut: "REJETEE", reference: "x" } }))).toBe("PROTEGE");
  });

  it("une ancienne permission n'est pas un congé ; une plage de congé sans demande suit `provisoire`", () => {
    expect(etatCongePlage(plage("2026-10-19", { source: "PERMISSION", demandeConge: null }))).toBeNull();
    expect(etatCongePlage(plage("2026-10-19", { demandeConge: null }))).toBe("EN_CONGE");
    expect(etatCongePlage(plage("2026-10-19", { demandeConge: null, provisoire: true }))).toBe("EN_ATTENTE");
  });

  it("plusieurs plages le même jour : le plus fort l'emporte", () => {
    const attente = plage("2026-10-19", { provisoire: true, demandeConge: { statut: "EN_ATTENTE_RH", reference: "a" } });
    const protege = plage("2026-10-19", { provisoire: true, demandeConge: { statut: "ANNULEE", reference: "b" } });
    expect(etatCongeDuJour([protege, attente])).toBe("EN_ATTENTE");
    expect(etatCongeDuJour([protege, attente, plage("2026-10-19")])).toBe("EN_CONGE");
    expect(etatCongeDuJour([])).toBeNull();
  });
});

describe("libellé de l'onglet « Absence autorisée »", () => {
  it("congé validé, en attente, ancienne permission", () => {
    expect(libelleAbsenceAutorisee([plage("2026-10-19")])).toBe("En congé (CNG-202610-0001)");
    expect(
      libelleAbsenceAutorisee([plage("2026-10-19", { provisoire: true, demandeConge: { statut: "EN_ATTENTE_RESPONSABLE", reference: "CNG-202610-0002" } })])
    ).toBe("Congé en attente de validation (CNG-202610-0002)");
    expect(libelleAbsenceAutorisee([plage("2026-10-19", { source: "PERMISSION", demandeConge: null, heureDebut: "08:00", heureFin: "10:00" })])).toBe(
      "Permission 08:00–10:00"
    );
  });
});

describe("jours de congé d'une période", () => {
  // Du lundi 19 au dimanche 25 octobre 2026 ; le mercredi 21 est férié pour le test.
  const semaine = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];

  it("seuls les jours ouvrés validés comptent (ni week-end, ni férié, ni en attente, ni protégé)", () => {
    const plages = [
      ...semaine.map((j) => plage(j)),
      plage("2026-10-26", { provisoire: true, demandeConge: { statut: "EN_ATTENTE_RH", reference: "x" } }),
      plage("2026-10-27", { provisoire: true, demandeConge: { statut: "REJETEE", reference: "y" } }),
    ];
    expect(syntheseCongesPeriode({ plages, arrivees: [], joursFeries: ["2026-10-21"] })).toEqual({ joursConge: 4, joursPointesEnConge: 0 });
  });

  it("deux plages le même jour ne comptent qu'une fois", () => {
    expect(syntheseCongesPeriode({ plages: [plage("2026-10-19"), plage("2026-10-19")], arrivees: [], joursFeries: [] }).joursConge).toBe(1);
  });

  it("une arrivée pointée un jour de congé validé est comptée (R13), pas un jour en attente", () => {
    const plages = [plage("2026-10-19"), plage("2026-10-20", { provisoire: true, demandeConge: { statut: "EN_ATTENTE_RH", reference: "x" } })];
    const arrivees = [new Date(2026, 9, 19, 8, 5), new Date(2026, 9, 20, 7, 50), new Date(2026, 9, 22, 7, 40)];
    expect(syntheseCongesPeriode({ plages, arrivees, joursFeries: [] })).toEqual({ joursConge: 1, joursPointesEnConge: 1 });
  });
});

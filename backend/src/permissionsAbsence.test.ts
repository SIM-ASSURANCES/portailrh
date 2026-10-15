import { describe, expect, it } from "vitest";
import {
  bornesMois,
  calculerDureeMinutes,
  calculerEcartRetour,
  controlerRetourReel,
  controlerSaisiePermission,
  evaluerPlafond,
  formatMinutesEnHeures,
  heureEnMinutes,
  plagesHorairesSeChevauchent,
  premierChevauchementHoraire,
  verifierDureeAutorisee,
} from "./permissionsAbsence";
import { MESSAGE_PERMISSION_SANS_MODIFICATION, actionsPossiblesAbsence, transitionAbsence } from "./circuitAbsence";

describe("heures et durées", () => {
  it("lit et calcule les heures HH:MM", () => {
    expect(heureEnMinutes("08:30")).toBe(510);
    expect(heureEnMinutes("24:00")).toBeNull();
    expect(heureEnMinutes("8:30")).toBeNull();
    expect(calculerDureeMinutes("08:00", "10:30")).toBe(150);
    expect(calculerDureeMinutes("10:00", "08:00")).toBe(0);
    expect(calculerDureeMinutes("x", "08:00")).toBe(0);
  });
  it("formate les minutes", () => {
    expect(formatMinutesEnHeures(150)).toBe("2h30");
    expect(formatMinutesEnHeures(45)).toBe("45 min");
    expect(formatMinutesEnHeures(120)).toBe("2h");
    expect(formatMinutesEnHeures(0)).toBe("0 min");
    expect(formatMinutesEnHeures(65)).toBe("1h05");
  });
  it("durée autorisée : maximum du type et avertissement au-delà de 4 h", () => {
    expect(verifierDureeAutorisee(180, 3)).toEqual({ valide: true, depasseMax: false, alerteCongeRecommande: false });
    expect(verifierDureeAutorisee(181, 3)).toMatchObject({ valide: false, depasseMax: true });
    expect(verifierDureeAutorisee(0, 3).valide).toBe(false);
    expect(verifierDureeAutorisee(241, 8)).toMatchObject({ valide: true, alerteCongeRecommande: true });
    expect(verifierDureeAutorisee(240, 8).alerteCongeRecommande).toBe(false);
  });
});

describe("chevauchement horaire", () => {
  const a = { heureDepart: "09:00", heureRetour: "11:00" };
  it("détecte un vrai recouvrement, pas deux plages qui se touchent", () => {
    expect(plagesHorairesSeChevauchent(a, { heureDepart: "10:30", heureRetour: "12:00" })).toBe(true);
    expect(plagesHorairesSeChevauchent(a, { heureDepart: "08:00", heureRetour: "09:30" })).toBe(true);
    expect(plagesHorairesSeChevauchent(a, { heureDepart: "09:30", heureRetour: "10:00" })).toBe(true);
    expect(plagesHorairesSeChevauchent(a, { heureDepart: "11:00", heureRetour: "12:00" })).toBe(false);
    expect(plagesHorairesSeChevauchent(a, { heureDepart: "07:00", heureRetour: "09:00" })).toBe(false);
  });
  it("renvoie la première plage en conflit", () => {
    const liste = [
      { heureDepart: "07:00", heureRetour: "08:00", reference: "A" },
      { heureDepart: "10:00", heureRetour: "10:30", reference: "B" },
    ];
    expect(premierChevauchementHoraire(a, liste)?.reference).toBe("B");
    expect(premierChevauchementHoraire({ heureDepart: "12:00", heureRetour: "13:00" }, liste)).toBeNull();
  });
});

describe("écart de retour, plafond, mois", () => {
  it("écart de retour", () => {
    expect(calculerEcartRetour("11:00", "11:20")).toEqual({ depassement: true, minutesEcart: 20 });
    expect(calculerEcartRetour("11:00", "10:40")).toEqual({ depassement: false, minutesEcart: -20 });
  });
  it("plafond atteint à la valeur du plafond", () => {
    expect(evaluerPlafond({ utilise: 1, plafond: 2 })).toEqual({ atteint: false, restant: 1 });
    expect(evaluerPlafond({ utilise: 2, plafond: 2 })).toEqual({ atteint: true, restant: 0 });
    expect(evaluerPlafond({ utilise: 5, plafond: 2 }).restant).toBe(0);
  });
  it("bornes du mois, février bissextile comprise", () => {
    expect(bornesMois("2026-10-15")).toEqual({ debut: "2026-10-01", fin: "2026-10-31" });
    expect(bornesMois("2028-02-10")).toEqual({ debut: "2028-02-01", fin: "2028-02-29" });
    expect(bornesMois("pas-une-date")).toBeNull();
  });
});

describe("contrôle de la saisie", () => {
  const base = { date: "2026-10-20", heureDepart: "09:00", heureRetourPrevue: "11:00", motif: "Rendez-vous médical", aujourdhui: "2026-10-15" };
  it("accepte une saisie valide et nettoie le motif", () => {
    expect(controlerSaisiePermission({ ...base, motif: "  Rendez-vous    médical " })).toEqual({ ok: true, dureeMinutes: 120, motif: "Rendez-vous médical" });
  });
  it("accepte le jour même, refuse le passé", () => {
    expect(controlerSaisiePermission({ ...base, date: "2026-10-15" }).ok).toBe(true);
    expect(controlerSaisiePermission({ ...base, date: "2026-10-14" })).toMatchObject({ ok: false, champ: "date" });
  });
  it("refuse retour avant départ, heures invalides, motif trop court", () => {
    expect(controlerSaisiePermission({ ...base, heureRetourPrevue: "08:00" })).toMatchObject({ ok: false, champ: "heureRetourPrevue" });
    expect(controlerSaisiePermission({ ...base, heureRetourPrevue: "09:00" })).toMatchObject({ ok: false, champ: "heureRetourPrevue" });
    expect(controlerSaisiePermission({ ...base, heureDepart: "9h" })).toMatchObject({ ok: false, champ: "heureDepart" });
    expect(controlerSaisiePermission({ ...base, motif: "abc" })).toMatchObject({ ok: false, champ: "motif" });
    expect(controlerSaisiePermission({ ...base, motif: "x".repeat(501) })).toMatchObject({ ok: false, champ: "motif" });
    expect(controlerSaisiePermission({ ...base, date: "2026-02-31" })).toMatchObject({ ok: false, champ: "date" });
  });
  it("retour réel : après le départ", () => {
    expect(controlerRetourReel({ heureDepart: "09:00", heureRetourReelle: "10:45" })).toEqual({ ok: true, dureeReelleMinutes: 105 });
    expect(controlerRetourReel({ heureDepart: "09:00", heureRetourReelle: "08:59" }).ok).toBe(false);
    expect(controlerRetourReel({ heureDepart: "09:00", heureRetourReelle: "25:00" }).ok).toBe(false);
  });
});

describe("une permission n'a pas de « modification demandée » (décision du Lot 4)", () => {
  const rh = { id: "rh", rolePermissions: ["absences.valider_rh"] };
  const params = {
    nature: "PERMISSION" as const,
    statut: "EN_ATTENTE_RH" as const,
    acteur: rh,
    demandeurId: "dem",
    decideur: { type: "RH", repli: false } as const,
  };
  it("refusée pour une permission, permise pour un congé", () => {
    const r = transitionAbsence({ ...params, action: { type: "DEMANDER_MODIFICATION", motif: "à reprendre" } });
    expect(r).toEqual({ ok: false, erreur: MESSAGE_PERMISSION_SANS_MODIFICATION });
    const conge = transitionAbsence({
      ...params,
      nature: "CONGE",
      acteur: { id: "rh", rolePermissions: ["conges.valider_rh"] },
      action: { type: "DEMANDER_MODIFICATION", motif: "à reprendre" },
    });
    expect(conge).toMatchObject({ ok: true, statut: "MODIFICATION_DEMANDEE" });
  });
  it("le bouton est grisé avec la même phrase, approuver et rejeter restent possibles", () => {
    const a = actionsPossiblesAbsence(params);
    expect(a.demanderModification).toBe(MESSAGE_PERMISSION_SANS_MODIFICATION);
    expect(a.approuver).toBeNull();
    expect(a.rejeter).toBeNull();
  });
});

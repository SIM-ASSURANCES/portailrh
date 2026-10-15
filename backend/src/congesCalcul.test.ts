import { describe, expect, it } from "vitest";

import {
  MESSAGE_CHEVAUCHEMENT_EXERCICE,
  MESSAGE_DATE_EMBAUCHE_MANQUANTE,
  ajouterJours,
  calculerAncienneteMois,
  calculerExercice,
  calculerNbJours,
  colonneDateDepuisJourCivil,
  dateFinPourJours,
  exerciceDuDebit,
  formatJourCivil,
  jourCivilDepuisColonneDate,
  listerJours,
  messageSoldeInsuffisant,
  parseJourCivil,
  periodesSeChevauchent,
  planifierDebit,
  premierChevauchement,
  repartirParExercice,
  verifierAnciennete,
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

describe("calculerNbJours — week-ends et jours fériés", () => {
  it("ouvrable : du lundi au vendredi = 5 jours", () => {
    const r = calculerNbJours({ debut: LUN, fin: VEN, decompte: "OUVRABLE", joursFeries: [] });
    expect(r.nbJours).toBe(5);
    expect(r.joursCalendaires).toBe(5);
  });

  it("ouvrable : du lundi au dimanche = 5 jours (samedi et dimanche exclus), 7 calendaires", () => {
    const r = calculerNbJours({ debut: LUN, fin: DIM, decompte: "OUVRABLE", joursFeries: [] });
    expect(r.nbJours).toBe(5);
    expect(r.joursCalendaires).toBe(7);
    expect(r.jours).toHaveLength(7);
  });

  it("ouvrable : un jour férié en semaine ne compte pas et est signalé", () => {
    const r = calculerNbJours({ debut: LUN, fin: VEN, decompte: "OUVRABLE", joursFeries: [MER] });
    expect(r.nbJours).toBe(4);
    expect(r.joursFeriesInclus).toEqual([MER]);
    expect(r.joursDecomptes).not.toContain(MER);
  });

  it("un jour férié un samedi ne change rien et n'est pas signalé (déjà non ouvré)", () => {
    const r = calculerNbJours({ debut: LUN, fin: DIM, decompte: "OUVRABLE", joursFeries: [SAM] });
    expect(r.nbJours).toBe(5);
    expect(r.joursFeriesInclus).toEqual([]);
  });

  it("calendaire : tous les jours comptent, week-ends et fériés compris", () => {
    const r = calculerNbJours({ debut: LUN, fin: DIM, decompte: "CALENDAIRE", joursFeries: [MER] });
    expect(r.nbJours).toBe(7);
    expect(r.joursDecomptes).toHaveLength(7);
  });

  it("un seul jour de week-end en ouvrable = 0 jour", () => {
    expect(calculerNbJours({ debut: SAM, fin: SAM, decompte: "OUVRABLE", joursFeries: [] }).nbJours).toBe(0);
  });

  it("fin avant début = 0", () => {
    expect(calculerNbJours({ debut: VEN, fin: LUN, decompte: "OUVRABLE", joursFeries: [] }).nbJours).toBe(0);
  });
});

describe("dateFinPourJours — types à durée fixée (article 13)", () => {
  it("ouvrable : 2 jours à partir du vendredi finissent le lundi", () => {
    expect(dateFinPourJours({ debut: VEN, nbJours: 2, decompte: "OUVRABLE", joursFeries: [] })).toBe(LUN_SUIVANT);
  });

  it("ouvrable : un lundi férié repousse la fin au mardi", () => {
    expect(dateFinPourJours({ debut: VEN, nbJours: 2, decompte: "OUVRABLE", joursFeries: [LUN_SUIVANT] })).toBe("2026-10-20");
  });

  it("ouvrable : un début le samedi commence au premier jour ouvré (lundi)", () => {
    expect(dateFinPourJours({ debut: SAM, nbJours: 1, decompte: "OUVRABLE", joursFeries: [] })).toBe(LUN_SUIVANT);
  });

  it("calendaire : début + nbJours - 1", () => {
    expect(dateFinPourJours({ debut: SAM, nbJours: 3, decompte: "CALENDAIRE", joursFeries: [] })).toBe(LUN_SUIVANT);
  });

  it("cohérence avec le décompte : la période obtenue compte exactement nbJours", () => {
    for (const nb of [1, 2, 4, 5, 9]) {
      const fin = dateFinPourJours({ debut: MER, nbJours: nb, decompte: "OUVRABLE", joursFeries: [VEN] });
      expect(calculerNbJours({ debut: MER, fin, decompte: "OUVRABLE", joursFeries: [VEN] }).nbJours).toBe(nb);
    }
  });
});

describe("exercice de congé (depuis la date d'embauche)", () => {
  it("embauché le 15 mars 2024 : au 15 octobre 2026, exercice du 15/03/2026 au 14/03/2027", () => {
    expect(calculerExercice("2024-03-15", "2026-10-15")).toEqual({ exercice: 2026, debut: "2026-03-15", fin: "2027-03-14" });
  });

  it("avant l'anniversaire de l'année, l'exercice est celui de l'année précédente", () => {
    expect(calculerExercice("2024-03-15", "2026-02-01")).toEqual({ exercice: 2025, debut: "2025-03-15", fin: "2026-03-14" });
  });

  it("le jour même de l'anniversaire ouvre le nouvel exercice, la veille appartient à l'ancien", () => {
    expect(calculerExercice("2024-03-15", "2026-03-15").exercice).toBe(2026);
    expect(calculerExercice("2024-03-15", "2026-03-14").exercice).toBe(2025);
  });

  it("embauché un 29 février : l'anniversaire tombe le 28 les années non bissextiles, le 29 sinon", () => {
    expect(calculerExercice("2024-02-29", "2026-06-01")).toEqual({ exercice: 2026, debut: "2026-02-28", fin: "2027-02-27" });
    expect(calculerExercice("2024-02-29", "2028-06-01")).toEqual({ exercice: 2028, debut: "2028-02-29", fin: "2029-02-27" });
  });

  it("deux exercices consécutifs se touchent sans trou ni recouvrement", () => {
    const a = calculerExercice("2023-08-31", "2026-10-15");
    const suivant = calculerExercice("2023-08-31", ajouterJours(a.fin, 1));
    expect(suivant.debut).toBe(ajouterJours(a.fin, 1));
    expect(suivant.exercice).toBe(a.exercice + 1);
  });
});

describe("congé à cheval sur deux exercices (D6 provisoire : refusé)", () => {
  const embauche = "2024-03-15";

  it("un congé entièrement dans un exercice débite cet exercice", () => {
    const r = calculerNbJours({ debut: LUN, fin: VEN, decompte: "OUVRABLE", joursFeries: [] });
    const d = exerciceDuDebit(r.joursDecomptes, embauche);
    expect(d.ok && d.exercice.exercice).toBe(2026);
  });

  it("un congé de l'an prochain débite l'exercice de ses jours, pas celui d'aujourd'hui", () => {
    const r = calculerNbJours({ debut: "2027-06-07", fin: "2027-06-11", decompte: "OUVRABLE", joursFeries: [] });
    const d = exerciceDuDebit(r.joursDecomptes, embauche);
    expect(d.ok && d.exercice.exercice).toBe(2027);
  });

  it("un congé qui franchit l'anniversaire (14 → 17 mars 2027) est refusé avec le message prévu", () => {
    const r = calculerNbJours({ debut: "2027-03-12", fin: "2027-03-17", decompte: "OUVRABLE", joursFeries: [] });
    expect([...repartirParExercice(r.joursDecomptes, embauche).keys()].sort()).toEqual([2026, 2027]);
    expect(exerciceDuDebit(r.joursDecomptes, embauche)).toEqual({ ok: false, erreur: MESSAGE_CHEVAUCHEMENT_EXERCICE });
  });

  it("si seuls les week-ends franchissent l'anniversaire, aucun jour décompté n'est de l'autre exercice", () => {
    // Vendredi 12/03/2027 puis samedi 13 et dimanche 14 (veille de l'anniversaire) : tout est dans l'exercice 2026.
    const r = calculerNbJours({ debut: "2027-03-12", fin: "2027-03-14", decompte: "OUVRABLE", joursFeries: [] });
    expect(r.nbJours).toBe(1);
    const d = exerciceDuDebit(r.joursDecomptes, embauche);
    expect(d.ok && d.exercice.exercice).toBe(2026);
  });

  it("aucun jour décompté : refus explicite", () => {
    expect(exerciceDuDebit([], embauche).ok).toBe(false);
  });
});

describe("ancienneté", () => {
  it("mois révolus : 5 mois la veille des 6 mois, 6 le jour même", () => {
    expect(calculerAncienneteMois("2026-04-15", "2026-10-14")).toBe(5);
    expect(calculerAncienneteMois("2026-04-15", "2026-10-15")).toBe(6);
  });

  it("un embauché le 31 janvier a 1 mois le dernier jour de février", () => {
    expect(calculerAncienneteMois("2026-01-31", "2026-02-28")).toBe(1);
    expect(calculerAncienneteMois("2026-01-31", "2026-02-27")).toBe(0);
  });

  it("jamais négative (embauche dans le futur)", () => {
    expect(calculerAncienneteMois("2026-12-01", "2026-10-15")).toBe(0);
  });

  it("article 13 : 6 mois exigés, refus à 5 mois avec le détail", () => {
    const r = verifierAnciennete({ dateEmbauche: "2026-04-15", moisRequis: 6, reference: "2026-10-14" });
    expect(r.eligible).toBe(false);
    if (!r.eligible) expect(r.erreur).toContain("6 mois");
    expect(verifierAnciennete({ dateEmbauche: "2026-04-15", moisRequis: 6, reference: "2026-10-15" }).eligible).toBe(true);
  });

  it("B7 : sans date d'embauche, un type qui exige de l'ancienneté est refusé (aucun repli sur la création du compte)", () => {
    const r = verifierAnciennete({ dateEmbauche: null, moisRequis: 6, reference: "2026-10-15" });
    expect(r).toEqual({ eligible: false, erreur: MESSAGE_DATE_EMBAUCHE_MANQUANTE, moisAnciennete: null });
  });

  it("un type sans exigence d'ancienneté reste accessible", () => {
    expect(verifierAnciennete({ dateEmbauche: null, moisRequis: 0, reference: "2026-10-15" }).eligible).toBe(true);
  });
});

describe("solde", () => {
  it("type non déductible : jamais de débit, jamais de refus", () => {
    expect(planifierDebit({ nonDeductible: true, nbJoursDefaut: 0, soldeRestant: 0, nbJours: 12 })).toEqual({
      aDebiter: 0,
      disponible: 0,
      suffisant: true,
      manque: 0,
    });
  });

  it("sans ligne de solde, la dotation du type fait foi", () => {
    const plan = planifierDebit({ nonDeductible: false, nbJoursDefaut: 30, soldeRestant: null, nbJours: 5 });
    expect(plan).toMatchObject({ aDebiter: 5, disponible: 30, suffisant: true });
  });

  it("solde exactement égal : suffisant ; un jour de plus : insuffisant avec le manque", () => {
    expect(planifierDebit({ nonDeductible: false, nbJoursDefaut: 30, soldeRestant: 5, nbJours: 5 }).suffisant).toBe(true);
    const plan = planifierDebit({ nonDeductible: false, nbJoursDefaut: 30, soldeRestant: 5, nbJours: 6 });
    expect(plan).toMatchObject({ suffisant: false, manque: 1 });
    expect(messageSoldeInsuffisant(plan)).toBe("Solde insuffisant : 5 jour(s) disponible(s), 6 demandé(s).");
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

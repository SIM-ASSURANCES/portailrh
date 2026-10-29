import { describe, expect, it } from "vitest";
import {
  dernierCreneau,
  erreurCourte,
  libelleBilan,
  prochaineExecution,
  prochainCreneau,
  tacheEnRetard,
  tachesDues,
} from "./planificateur";

// Dates locales (aucune dépendance au fuseau de la machine de test). 2026-10-14 est un mercredi, le 17 un samedi.
const d = (jour: number, h: number, m = 0, s = 0) => new Date(2026, 9, jour, h, m, s);

describe("relances : toutes les 5 minutes", () => {
  it("le créneau est la dernière minute multiple de 5", () => {
    expect(dernierCreneau("RELANCES_JUSTIFICATION", d(14, 10, 7, 42))).toEqual(d(14, 10, 5));
    expect(dernierCreneau("RELANCES_JUSTIFICATION", d(14, 10, 5, 0))).toEqual(d(14, 10, 5));
    expect(prochainCreneau("RELANCES_JUSTIFICATION", d(14, 10, 5, 0))).toEqual(d(14, 10, 10));
  });

  it("due quand le créneau n'est pas couvert, pas deux fois dans le même créneau", () => {
    expect(tachesDues(d(14, 10, 5, 3), { RELANCES_JUSTIFICATION: d(14, 10, 0, 2) })).toContain("RELANCES_JUSTIFICATION");
    expect(tachesDues(d(14, 10, 6, 3), { RELANCES_JUSTIFICATION: d(14, 10, 5, 3) })).not.toContain("RELANCES_JUSTIFICATION");
    expect(tachesDues(d(14, 10, 9, 59), { RELANCES_JUSTIFICATION: d(14, 10, 5, 3) })).not.toContain("RELANCES_JUSTIFICATION");
    expect(tachesDues(d(14, 10, 10, 0), { RELANCES_JUSTIFICATION: d(14, 10, 5, 3) })).toContain("RELANCES_JUSTIFICATION");
  });

  it("jamais exécutée : due tout de suite", () => {
    expect(tachesDues(d(14, 10, 1), {})).toContain("RELANCES_JUSTIFICATION");
  });
});

describe("absences : lundi au vendredi à 17:30 et 20:00", () => {
  const derniere = (date: Date) => ({ ABSENCES: date, PURGE: d(14, 3, 0) });

  it("pas due avant 17:30, due à 17:30 puis à 20:00", () => {
    expect(tachesDues(d(14, 17, 29), derniere(d(13, 20, 0)))).not.toContain("ABSENCES");
    expect(tachesDues(d(14, 17, 30), derniere(d(13, 20, 0)))).toContain("ABSENCES");
    expect(tachesDues(d(14, 18, 0), derniere(d(14, 17, 30, 2)))).not.toContain("ABSENCES");
    expect(tachesDues(d(14, 20, 0), derniere(d(14, 17, 30, 2)))).toContain("ABSENCES");
    expect(tachesDues(d(14, 23, 0), derniere(d(14, 20, 0, 1)))).not.toContain("ABSENCES");
  });

  it("rien le week-end : le dernier créneau est celui du vendredi 20:00, déjà couvert", () => {
    expect(dernierCreneau("ABSENCES", d(17, 18, 0))).toEqual(d(16, 20, 0));
    expect(tachesDues(d(17, 18, 0), { ABSENCES: d(16, 20, 0, 5), PURGE: d(17, 3, 0) })).not.toContain("ABSENCES");
    expect(tachesDues(d(18, 20, 0), { ABSENCES: d(16, 20, 0, 5), PURGE: d(18, 3, 0) })).not.toContain("ABSENCES");
  });

  it("le prochain créneau saute le week-end", () => {
    expect(prochainCreneau("ABSENCES", d(16, 21, 0))).toEqual(d(19, 17, 30));
    expect(prochainCreneau("ABSENCES", d(14, 9, 0))).toEqual(d(14, 17, 30));
  });

  it("redémarrage après une heure manquée : rattrapé au premier passage", () => {
    // Serveur arrêté de 17:00 à 19:00 : le créneau de 17:30 n'a pas eu lieu.
    expect(tachesDues(d(14, 19, 0), derniere(d(13, 20, 0)))).toContain("ABSENCES");
    // Serveur arrêté tout le week-end : le vendredi 20:00 manqué est rattrapé le lundi matin.
    expect(tachesDues(d(19, 8, 0), { ABSENCES: d(16, 17, 30, 3), PURGE: d(19, 3, 0) })).toContain("ABSENCES");
  });
});

describe("purge : une fois par jour à 03:00", () => {
  it("due après 03:00 si pas déjà faite aujourd'hui", () => {
    expect(tachesDues(d(14, 2, 59), { PURGE: d(13, 3, 0) })).not.toContain("PURGE");
    expect(tachesDues(d(14, 3, 0), { PURGE: d(13, 3, 0) })).toContain("PURGE");
    expect(tachesDues(d(14, 15, 0), { PURGE: d(14, 3, 1) })).not.toContain("PURGE");
  });
});

describe("rappels congés : lundi au vendredi à 08:30", () => {
  // 2026-10-13 = mardi, 2026-10-16 = vendredi, 2026-10-17 = samedi, 2026-10-19 = lundi.
  it("créneau d'un mardi 09:00 → 08:30 du jour", () => {
    expect(dernierCreneau("RAPPELS_CONGES", d(13, 9, 0))).toEqual(d(13, 8, 30));
  });

  it("créneau d'un lundi 08:00 → vendredi 08:30", () => {
    expect(dernierCreneau("RAPPELS_CONGES", d(19, 8, 0))).toEqual(d(16, 8, 30));
  });

  it("créneau d'un samedi → vendredi 08:30", () => {
    expect(dernierCreneau("RAPPELS_CONGES", d(17, 12, 0))).toEqual(d(16, 8, 30));
  });

  it("en retard à 09:01 sans exécution", () => {
    expect(tacheEnRetard("RAPPELS_CONGES", d(13, 9, 0), null)).toBe(false);
    expect(tacheEnRetard("RAPPELS_CONGES", d(13, 9, 1), null)).toBe(true);
    expect(tacheEnRetard("RAPPELS_CONGES", d(13, 9, 1), d(13, 8, 31))).toBe(false);
  });
});

describe("double instance", () => {
  it("l'exécution ignorée d'une instance compte : l'autre ne la relance pas pour le même créneau", () => {
    // Instance A a pris le verrou ; instance B a enregistré une exécution IGNOREE à 10:05:04.
    const lues = { RELANCES_JUSTIFICATION: d(14, 10, 5, 4), ABSENCES: d(14, 3, 0), PURGE: d(14, 3, 0) };
    expect(tachesDues(d(14, 10, 5, 30), lues)).not.toContain("RELANCES_JUSTIFICATION");
  });
});

describe("prochaine exécution et retard", () => {
  it("prochaine exécution : maintenant si un créneau passé n'est pas couvert, sinon le créneau suivant", () => {
    const now = d(14, 10, 7);
    expect(prochaineExecution("RELANCES_JUSTIFICATION", now, d(14, 10, 0, 3))).toEqual(now);
    expect(prochaineExecution("RELANCES_JUSTIFICATION", now, d(14, 10, 5, 3))).toEqual(d(14, 10, 10));
  });

  it("relances en retard sans succès depuis deux intervalles (10 min) ou jamais", () => {
    const now = d(14, 10, 30);
    expect(tacheEnRetard("RELANCES_JUSTIFICATION", now, d(14, 10, 25))).toBe(false);
    expect(tacheEnRetard("RELANCES_JUSTIFICATION", now, d(14, 10, 20))).toBe(false);
    expect(tacheEnRetard("RELANCES_JUSTIFICATION", now, d(14, 10, 19, 59))).toBe(true);
    expect(tacheEnRetard("RELANCES_JUSTIFICATION", now, null)).toBe(true);
  });

  it("absences en retard quand le créneau est passé de plus de 30 min sans succès depuis", () => {
    expect(tacheEnRetard("ABSENCES", d(14, 17, 59), d(13, 20, 0))).toBe(false);
    expect(tacheEnRetard("ABSENCES", d(14, 18, 1), d(13, 20, 0))).toBe(true);
    expect(tacheEnRetard("ABSENCES", d(14, 18, 1), d(14, 17, 31))).toBe(false);
    // Samedi : le dernier créneau (vendredi 20:00) est couvert, pas de retard.
    expect(tacheEnRetard("ABSENCES", d(17, 12, 0), d(16, 20, 1))).toBe(false);
  });
});

describe("libellés", () => {
  it("bilan lisible", () => {
    expect(libelleBilan("RELANCES_JUSTIFICATION", { envois: 3, clotures: 1, erreurs: 0 })).toBe("3 envois, 1 clôture, 0 erreur");
    expect(libelleBilan("ABSENCES", { nouvellesAbsences: 2, oublisDetectes: 1 })).toBe("2 nouvelles absences, 1 oubli de départ");
    expect(libelleBilan("PURGE", null)).toBe("0 exécution et 0 incident supprimés");
    expect(libelleBilan("RAPPELS_CONGES", { rappels: 2, erreurs: 1 })).toBe("2 rappels, 1 erreur");
  });

  it("erreur courte : une ligne, 200 caractères", () => {
    const e = new Error("première ligne\nseconde ligne avec une donnée");
    expect(erreurCourte(e)).toBe("Error: première ligne");
    expect(erreurCourte(new Error("x".repeat(500))).length).toBe(200);
  });
});

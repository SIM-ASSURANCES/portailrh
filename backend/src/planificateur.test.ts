import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  dernierCreneau,
  erreurCourte,
  LIBELLE_TACHE,
  libelleBilan,
  prochaineExecution,
  prochainCreneau,
  tacheEnRetard,
  TOUTES_LES_TACHES,
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

describe("Gestion Compta : contrôle hebdomadaire le lundi à 07:30", () => {
  // 2026-10-05, 12 et 19 sont des lundis ; le 14 est un mercredi.
  it("le créneau est le dernier lundi 07:30 passé", () => {
    expect(dernierCreneau("COMPTA_CONTROLE_HEBDO", d(14, 10, 0))).toEqual(d(12, 7, 30));
    expect(dernierCreneau("COMPTA_CONTROLE_HEBDO", d(12, 7, 29))).toEqual(d(5, 7, 30));
    expect(dernierCreneau("COMPTA_CONTROLE_HEBDO", d(12, 7, 30))).toEqual(d(12, 7, 30));
  });

  it("le prochain créneau est le lundi suivant", () => {
    expect(prochainCreneau("COMPTA_CONTROLE_HEBDO", d(14, 10, 0))).toEqual(d(19, 7, 30));
    expect(prochainCreneau("COMPTA_CONTROLE_HEBDO", d(12, 7, 30))).toEqual(d(19, 7, 30));
  });

  it("due une seule fois par lundi, rattrapée après un arrêt", () => {
    expect(tachesDues(d(12, 7, 30), { COMPTA_CONTROLE_HEBDO: d(5, 7, 30, 1) })).toContain("COMPTA_CONTROLE_HEBDO");
    expect(tachesDues(d(12, 9, 0), { COMPTA_CONTROLE_HEBDO: d(12, 7, 30, 2) })).not.toContain("COMPTA_CONTROLE_HEBDO");
    // Serveur arrêté le lundi : rattrapée le mardi au premier passage.
    expect(tachesDues(d(13, 9, 0), { COMPTA_CONTROLE_HEBDO: d(5, 7, 30, 1) })).toContain("COMPTA_CONTROLE_HEBDO");
  });
});

describe("Gestion Compta : relances du lundi au vendredi à 08:00", () => {
  it("créneau d'un samedi → vendredi 08:00, d'un lundi 07:00 → vendredi 08:00", () => {
    expect(dernierCreneau("COMPTA_RELANCES", d(17, 12, 0))).toEqual(d(16, 8, 0));
    expect(dernierCreneau("COMPTA_RELANCES", d(19, 7, 0))).toEqual(d(16, 8, 0));
    expect(dernierCreneau("COMPTA_RELANCES", d(14, 8, 0))).toEqual(d(14, 8, 0));
  });

  it("le prochain créneau saute le week-end", () => {
    expect(prochainCreneau("COMPTA_RELANCES", d(16, 9, 0))).toEqual(d(19, 8, 0));
  });

  it("rien le week-end : le vendredi couvert, pas de nouvelle exécution", () => {
    expect(tachesDues(d(17, 12, 0), { COMPTA_RELANCES: d(16, 8, 0, 3) })).not.toContain("COMPTA_RELANCES");
    expect(tachesDues(d(19, 8, 0), { COMPTA_RELANCES: d(16, 8, 0, 3) })).toContain("COMPTA_RELANCES");
  });
});

describe("Gestion Compta : rappel de la taxe les 10 et 17 de chaque mois", () => {
  // 2026-10-10 et 2026-10-17 sont des samedis : le rappel est LITTÉRAL (le 10 et le 17), week-end compris.
  it("créneau du 10 ou du 17, à 08:00", () => {
    expect(dernierCreneau("COMPTA_RAPPEL_TCA", d(14, 12, 0))).toEqual(d(10, 8, 0));
    expect(dernierCreneau("COMPTA_RAPPEL_TCA", d(17, 7, 59))).toEqual(d(10, 8, 0));
    expect(dernierCreneau("COMPTA_RAPPEL_TCA", d(17, 8, 0))).toEqual(d(17, 8, 0));
  });

  it("franchit un mois entier : l'écart du 17 au 10 suivant dépasse les 8 jours des autres tâches", () => {
    // Lundi 9 novembre : le dernier créneau est le 17 octobre (23 jours en arrière).
    expect(dernierCreneau("COMPTA_RAPPEL_TCA", new Date(2026, 10, 9, 12, 0))).toEqual(d(17, 8, 0));
    // Le prochain après le 17 octobre est le 10 novembre (24 jours en avant), et non un repli de 24 h.
    expect(prochainCreneau("COMPTA_RAPPEL_TCA", d(17, 9, 0))).toEqual(new Date(2026, 10, 10, 8, 0));
  });

  it("chaque créneau n'est dû qu'une fois", () => {
    expect(tachesDues(d(10, 8, 0), { COMPTA_RAPPEL_TCA: new Date(2026, 8, 17, 8, 0, 2) })).toContain("COMPTA_RAPPEL_TCA");
    expect(tachesDues(d(12, 9, 0), { COMPTA_RAPPEL_TCA: d(10, 8, 0, 2) })).not.toContain("COMPTA_RAPPEL_TCA");
    expect(tachesDues(d(17, 8, 0), { COMPTA_RAPPEL_TCA: d(10, 8, 0, 2) })).toContain("COMPTA_RAPPEL_TCA");
  });

  it("en retard seulement 30 minutes après le créneau, sans succès", () => {
    expect(tacheEnRetard("COMPTA_RAPPEL_TCA", d(10, 8, 30), null)).toBe(false);
    expect(tacheEnRetard("COMPTA_RAPPEL_TCA", d(10, 8, 31), null)).toBe(true);
    expect(tacheEnRetard("COMPTA_RAPPEL_TCA", d(10, 8, 31), d(10, 8, 1))).toBe(false);
    // Entre deux créneaux, rien n'est en retard tant que le dernier a réussi.
    expect(tacheEnRetard("COMPTA_RAPPEL_TCA", d(14, 12, 0), d(10, 8, 1))).toBe(false);
  });
});

describe("registre des tâches : planificateur, enum Prisma et migrations restent synchronisés", () => {
  const racineBackend = fileURLToPath(new URL("..", import.meta.url));
  const schema = readFileSync(`${racineBackend}prisma/schema.prisma`, "utf8");
  const valeursEnum = [...(/enum TacheNom \{([^}]*)\}/.exec(schema)?.[1] ?? "").matchAll(/^\s*(\w+)\s*$/gm)].map((m) => m[1]);

  it("chaque tâche du registre est une valeur de l'enum TacheNom, et inversement", () => {
    expect([...valeursEnum].sort()).toEqual([...TOUTES_LES_TACHES].sort());
  });

  it("chaque tâche a un libellé", () => {
    expect(Object.keys(LIBELLE_TACHE).sort()).toEqual([...TOUTES_LES_TACHES].sort());
  });

  it("chaque valeur de l'enum est créée par une migration (sinon l'écriture de l'exécution échouerait en production)", () => {
    const dossier = `${racineBackend}prisma/migrations`;
    const sql = readdirSync(dossier, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => readFileSync(`${dossier}/${e.name}/migration.sql`, "utf8"))
      .join("\n");
    for (const tache of TOUTES_LES_TACHES) expect(sql, tache).toContain(`'${tache}'`);
  });
});

describe("libellés", () => {
  it("bilan lisible", () => {
    expect(libelleBilan("RELANCES_JUSTIFICATION", { envois: 3, clotures: 1, erreurs: 0 })).toBe("3 envois, 1 clôture, 0 erreur");
    expect(libelleBilan("ABSENCES", { nouvellesAbsences: 2, oublisDetectes: 1 })).toBe("2 nouvelles absences, 1 oubli de départ");
    expect(libelleBilan("PURGE", null)).toBe("0 exécution et 0 incident supprimés, 0 trace de quota FeedbackApp effacée");
    expect(libelleBilan("PURGE", { executionsSupprimees: 2, incidentsSupprimes: 1, quotasFeedbackSupprimes: 3 })).toBe(
      "2 exécutions et 1 incident supprimés, 3 traces de quota FeedbackApp effacées"
    );
    expect(libelleBilan("RAPPELS_CONGES", { rappels: 2, erreurs: 1 })).toBe("2 rappels, 1 erreur");
    // Tâches Gestion Compta : module non mis en service (rien lu), puis des chiffres ; le rappel de la taxe reste vide (GC-8).
    expect(libelleBilan("COMPTA_RELANCES", { traites: 0, erreurs: 0, enAttenteDuModule: true, moduleNonMisEnService: true })).toBe(
      "Aucun traitement pour l'instant (module non mis en service)"
    );
    expect(libelleBilan("COMPTA_CONTROLE_HEBDO", { moduleNonMisEnService: true })).toBe("Aucun traitement pour l'instant (module non mis en service)");
    expect(libelleBilan("COMPTA_RELANCES", { traites: 3, notifications: 5, silencieuses: 2, erreurs: 0 })).toBe(
      "3 lignes relancées, 5 notifications, 2 paliers réservés sans envoi, 0 erreur"
    );
    expect(libelleBilan("COMPTA_RELANCES", { traites: 0, notifications: 0, silencieuses: 40, erreurs: 0, premierPassage: true })).toBe(
      "Premier passage : arriéré réservé sans envoi (0 ligne relancée, 0 notification, 40 paliers réservés sans envoi, 0 erreur)"
    );
    expect(libelleBilan("COMPTA_CONTROLE_HEBDO", { notifications: 2, erreurs: 0 })).toBe("2 notifications de résumé, 0 erreur");
    expect(libelleBilan("COMPTA_RAPPEL_TCA", { traites: 0, erreurs: 0, enAttenteDuModule: true })).toBe("Aucun traitement pour l'instant (module en construction)");
    expect(libelleBilan("COMPTA_RAPPEL_TCA", null)).toBe("0 élément traité, 0 erreur");
  });

  it("erreur courte : une ligne, 200 caractères", () => {
    const e = new Error("première ligne\nseconde ligne avec une donnée");
    expect(erreurCourte(e)).toBe("Error: première ligne");
    expect(erreurCourte(new Error("x".repeat(500))).length).toBe(200);
  });
});

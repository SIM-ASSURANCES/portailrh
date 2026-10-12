import { describe, expect, it } from "vitest";

import {
  finJourneeJustification,
  messageAlerteDecideurJustification,
  messageClotureJustification,
  messageDemandeJustification,
  prochaineActionJustification,
  type EtatRelanceJustification,
  type ParametresRelanceJustification,
} from "./justificationPointage";

// Lot 5 (plan Pointage V2) : envois, relances et clôture. Heures locales, comme le module.
const P: ParametresRelanceJustification = {
  delaiDemandeJustificationMinutes: 15,
  intervalleRelanceJustificationMinutes: 30,
  nombreMaxRelancesJustification: 3,
  heureFinApresMidi: "16:45",
};
const h = (heure: string, jour = 12) => {
  const [hh, mm] = heure.split(":").map(Number);
  return new Date(2026, 9, jour, hh, mm, 0, 0);
};

/** Rejoue la tâche planifiée toutes les 5 minutes et note chaque action, en appliquant ses effets comme la route. */
function simuler(heurePointage: Date, debut: Date, fin: Date, params = P) {
  const etat: EtatRelanceJustification = { statut: "EN_ATTENTE", nombreEnvois: 0, dernierEnvoiAt: null, heurePointage };
  const actions: string[] = [];
  for (let t = debut.getTime(); t <= fin.getTime(); t += 5 * 60 * 1000) {
    const now = new Date(t);
    const a = prochaineActionJustification(etat, params, now);
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    if (a.type === "ENVOI") {
      actions.push(`envoi ${a.numero} ${hhmm}`);
      etat.nombreEnvois = a.numero;
      etat.dernierEnvoiAt = now;
    } else if (a.type === "CLOTURE") {
      actions.push(`clôture ${hhmm}`);
      etat.statut = "NON_JUSTIFIEE";
    }
  }
  return actions;
}

describe("prochaineActionJustification", () => {
  it("retard à 08:10 : envois à 08:25, 08:55 et 09:25, clôture à 16:45", () => {
    expect(simuler(h("08:10"), h("08:10"), h("18:00"))).toEqual(["envoi 1 08:25", "envoi 2 08:55", "envoi 3 09:25", "clôture 16:45"]);
  });

  it("départ anticipé à 16:40 : envoi à 16:55, clôture à 17:25", () => {
    expect(simuler(h("16:40"), h("16:40"), h("19:00"))).toEqual(["envoi 1 16:55", "clôture 17:25"]);
  });

  it("statut déjà SOUMISE (ou décidé, ou clôturé) : aucune action", () => {
    for (const statut of ["SOUMISE", "ACCEPTEE", "REFUSEE", "NON_JUSTIFIEE"] as const) {
      expect(prochaineActionJustification({ statut, nombreEnvois: 0, dernierEnvoiAt: null, heurePointage: h("08:10") }, P, h("12:00"))).toEqual({ type: "AUCUNE" });
    }
  });

  it("maximum d'envois atteint : plus d'envoi avant la fin de journée, puis clôture", () => {
    const etat: EtatRelanceJustification = { statut: "EN_ATTENTE", nombreEnvois: 3, dernierEnvoiAt: h("09:25"), heurePointage: h("08:10") };
    expect(prochaineActionJustification(etat, P, h("12:00"))).toEqual({ type: "AUCUNE" });
    expect(prochaineActionJustification(etat, P, h("16:44"))).toEqual({ type: "AUCUNE" });
    expect(prochaineActionJustification(etat, P, h("16:45"))).toEqual({ type: "CLOTURE" });
  });

  it("avant le délai : rien ; pile au délai : premier envoi", () => {
    const etat: EtatRelanceJustification = { statut: "EN_ATTENTE", nombreEnvois: 0, dernierEnvoiAt: null, heurePointage: h("08:10") };
    expect(prochaineActionJustification(etat, P, h("08:24"))).toEqual({ type: "AUCUNE" });
    expect(prochaineActionJustification(etat, P, h("08:25"))).toEqual({ type: "ENVOI", numero: 1 });
  });

  it("tâche planifiée en panne la veille : rattrapage le lendemain (envoi, puis clôture un intervalle plus tard)", () => {
    const etat: EtatRelanceJustification = { statut: "EN_ATTENTE", nombreEnvois: 0, dernierEnvoiAt: null, heurePointage: h("08:10", 12) };
    expect(prochaineActionJustification(etat, P, h("07:00", 13))).toEqual({ type: "ENVOI", numero: 1 });
    const apres = { ...etat, nombreEnvois: 1, dernierEnvoiAt: h("07:00", 13) };
    expect(prochaineActionJustification(apres, P, h("07:15", 13))).toEqual({ type: "AUCUNE" });
    expect(prochaineActionJustification(apres, P, h("07:30", 13))).toEqual({ type: "CLOTURE" });
  });

  it("paramètres RH modifiés : 1 seul envoi, délai 5 min, intervalle 10 min", () => {
    const p = { ...P, delaiDemandeJustificationMinutes: 5, intervalleRelanceJustificationMinutes: 10, nombreMaxRelancesJustification: 1 };
    expect(simuler(h("16:00"), h("16:00"), h("17:30"), p)).toEqual(["envoi 1 16:05", "clôture 16:45"]);
  });

  it("fin de journée : jour du pointage à heureFinApresMidi", () => {
    expect(finJourneeJustification(h("08:10"), "16:45").getTime()).toBe(h("16:45").getTime());
  });
});

describe("messages des envois", () => {
  const retard = { type: "ARRIVEE" as const, heure: h("08:10"), minutesRetard: 25 };
  it("collaborateur : demande puis rappel numéroté", () => {
    expect(messageDemandeJustification({ pointage: retard, numero: 1, nombreMax: 3 }).titre).toBe("Justifiez votre retard");
    expect(messageDemandeJustification({ pointage: retard, numero: 2, nombreMax: 3 }).titre).toBe("Rappel (2/3) : justification attendue");
  });
  it("décideur RH : la raison est explicite (responsable de service en retard)", () => {
    const m = messageAlerteDecideurJustification({
      collaborateurNom: "Awa",
      serviceNom: "Commercial",
      decideur: { type: "RH", raison: "EST_RESPONSABLE" },
      pointage: retard,
    });
    expect(m.message).toContain("Awa, responsable du service Commercial, est arrivé en retard de 25 min");
  });
  it("décideur, à la clôture : non justifié, peut encore le faire", () => {
    const m = messageClotureJustification({
      collaborateurNom: "Awa",
      serviceNom: "Commercial",
      decideur: { type: "RESPONSABLE", responsableId: "r1" },
      pointage: retard,
    });
    expect(m.message).toContain("Awa n'a pas justifié son retard de 25 min");
  });
});

// C1 (consignes du 2026-10-16) : chaque modification d'un type de congé est historisée avec l'ancienne ET la nouvelle valeur.

import { describe, expect, it } from "vitest";

import { MESSAGE_NB_JOURS_SOLDES_FUTURS, decrireModificationType, type TypeCongeDecrit } from "./typesCongeHistorique";

const annuel: TypeCongeDecrit = {
  code: "ANNUEL",
  label: "Congé annuel",
  categorie: "CONGE_STANDARD",
  nbJoursDefaut: 30,
  decompteType: "OUVRABLE",
  justificatifObligatoire: false,
  nonDeductibleSolde: false,
  ancienneteMinimumMois: 12,
};

describe("Historique d'une modification de type de congé", () => {
  it("donne l'ancienne et la nouvelle valeur du nombre de jours", () => {
    const d = decrireModificationType(annuel, { ...annuel, nbJoursDefaut: 28 });
    expect(d).toContain("Congé annuel");
    expect(d).toContain("jours accordés : 30 → 28");
  });

  it("ne cite que ce qui change", () => {
    const d = decrireModificationType(annuel, { ...annuel, nbJoursDefaut: 28, ancienneteMinimumMois: 6 });
    expect(d).toContain("30 → 28");
    expect(d).toContain("ancienneté minimale (mois) : 12 → 6");
    expect(d).not.toContain("décompte");
    expect(d).not.toContain("pièce justificative");
  });

  it("traduit les valeurs lisibles (décompte, booléens)", () => {
    const d = decrireModificationType(annuel, { ...annuel, decompteType: "CALENDAIRE", justificatifObligatoire: true, nonDeductibleSolde: true });
    expect(d).toContain("décompte : jours ouvrables (lundi à vendredi) → jours calendaires");
    expect(d).toContain("pièce justificative obligatoire : non → oui");
    expect(d).toContain("non déduit du solde : non → oui");
  });

  it("signale l'absence de changement", () => {
    expect(decrireModificationType(annuel, { ...annuel })).toContain("aucune valeur modifiée");
  });

  it("le message d'écran dit que seuls les soldes créés ensuite sont concernés", () => {
    expect(MESSAGE_NB_JOURS_SOLDES_FUTURS).toMatch(/soldes créés ensuite/);
    expect(MESSAGE_NB_JOURS_SOLDES_FUTURS).toMatch(/Ajuster/);
  });
});

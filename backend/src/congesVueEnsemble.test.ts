import { describe, expect, it } from "vitest";

import {
  COLONNES_EXPORT_CONGE,
  filtresCongesDepuisRecherche,
  ligneExportConge,
  STATUTS_CONGE_VUE_ENSEMBLE,
  type DemandeCongeExportSource,
} from "./congesVueEnsemble";

function demandeBase(partiel: Partial<DemandeCongeExportSource> = {}): DemandeCongeExportSource {
  return {
    reference: "CNG-202610-0001",
    nature: "CONGE",
    motif: "Congé annuel familial",
    dateDebut: "2026-10-20",
    dateFin: "2026-10-23",
    nbJoursOuvres: 4,
    statut: "VALIDEE",
    etapeResponsableRequise: true,
    saisieParRH: false,
    observationRH: null,
    user: { fullName: "Konan Kouassi", service: { name: "Commercial" } },
    approuvePar: { fullName: "Chef Commercial" },
    approuveAt: new Date(2026, 9, 18, 10, 30),
    validePar: { fullName: "Responsable RH" },
    valideAt: new Date(2026, 9, 19, 14, 15),
    ...partiel,
  };
}

describe("filtresCongesDepuisRecherche", () => {
  it("applique les valeurs par défaut : mois en cours et statut VALIDEE", () => {
    const r = filtresCongesDepuisRecherche({}, "2026-10-20");
    expect(r).toEqual({
      ok: true,
      du: "2026-10-01",
      au: "2026-10-31",
      statuts: ["VALIDEE"],
      statut: "VALIDEE",
      serviceId: null,
      nature: null,
    });
  });

  it("accepte statut=TOUS et renvoie tous les statuts du circuit", () => {
    const r = filtresCongesDepuisRecherche({ statut: "TOUS", service: "srv-1", nature: "PERMISSION_EXCEPTIONNELLE" }, "2026-02-15");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.du).toBe("2026-02-01");
    expect(r.au).toBe("2026-02-28");
    expect(r.statut).toBe("TOUS");
    expect(r.statuts).toEqual([...STATUTS_CONGE_VUE_ENSEMBLE]);
    expect(r.serviceId).toBe("srv-1");
    expect(r.nature).toBe("PERMISSION_EXCEPTIONNELLE");
  });

  it("refuse une date invalide", () => {
    const r1 = filtresCongesDepuisRecherche({ du: "2026-02-30", au: "2026-03-05" }, "2026-10-20");
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.erreur).toContain("AAAA-MM-JJ");

    const r2 = filtresCongesDepuisRecherche({ du: "invalide" }, "2026-10-20");
    expect(r2.ok).toBe(false);
  });

  it("refuse quand du > au", () => {
    const r = filtresCongesDepuisRecherche({ du: "2026-10-25", au: "2026-10-20" }, "2026-10-20");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur).toContain("dépasser");
  });

  it("refuse une période qui dépasse 366 jours", () => {
    const r = filtresCongesDepuisRecherche({ du: "2026-01-01", au: "2027-01-02" }, "2026-10-20");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur).toContain("366");
  });
});

describe("ligneExportConge", () => {
  it("produit les 13 colonnes dans l'ordre attendu pour une demande validée avec étape responsable", () => {
    const ligne = ligneExportConge(demandeBase({ observationRH: "Bon congé" }));
    expect(Object.keys(ligne)).toEqual(COLONNES_EXPORT_CONGE.map((c) => c.cle));
    expect(Object.keys(ligne)).toHaveLength(13);
    expect(ligne.reference).toBe("CNG-202610-0001");
    expect(ligne.collaborateur).toBe("Konan Kouassi");
    expect(ligne.service).toBe("Commercial");
    expect(ligne.nature).toBe("Congé");
    expect(ligne.motif).toBe("Congé annuel familial");
    expect(ligne.du).toEqual(new Date("2026-10-20T00:00:00.000Z"));
    expect(ligne.au).toEqual(new Date("2026-10-23T00:00:00.000Z"));
    expect(ligne.joursOuvres).toBe(4);
    expect(ligne.statut).toBe("Validée");
    expect(ligne.responsable).toBe("Chef Commercial, 18/10/2026");
    expect(ligne.decisionRH).toBe("Responsable RH, 19/10/2026");
    expect(ligne.observationRH).toBe("Bon congé");
    expect(ligne.saisieParRH).toBe("Non");
  });

  it("affiche « Non requise » dans la colonne Responsable quand l'étape responsable n'était pas requise", () => {
    const ligne = ligneExportConge(
      demandeBase({
        etapeResponsableRequise: false,
        approuvePar: null,
        approuveAt: null,
      })
    );
    expect(ligne.responsable).toBe("Non requise");
  });

  it("marque « Oui » pour une saisie RH et indique « Non requise » pour le responsable", () => {
    const ligne = ligneExportConge(
      demandeBase({
        etapeResponsableRequise: false,
        saisieParRH: true,
        approuvePar: null,
        approuveAt: null,
        validePar: { fullName: "Awa RH" },
        valideAt: new Date(2026, 9, 20, 9, 0),
      })
    );
    expect(ligne.saisieParRH).toBe("Oui");
    expect(ligne.responsable).toBe("Non requise");
    expect(ligne.decisionRH).toBe("Awa RH, 20/10/2026");
  });

  it("laisse les colonnes de décision vides pour une demande encore en attente", () => {
    const ligne = ligneExportConge(
      demandeBase({
        statut: "EN_ATTENTE_RESPONSABLE",
        etapeResponsableRequise: true,
        approuvePar: null,
        approuveAt: null,
        validePar: null,
        valideAt: null,
      })
    );
    expect(ligne.statut).toBe("En attente du responsable");
    expect(ligne.responsable).toBe("");
    expect(ligne.decisionRH).toBe("");
  });

  it("renseigne le nom et la date de la décision RH en cas de refus RH", () => {
    const ligne = ligneExportConge(
      demandeBase({
        statut: "REJETEE",
        validePar: { fullName: "Awa RH" },
        valideAt: new Date(2026, 9, 21, 16, 0),
        observationRH: "Période de clôture",
      })
    );
    expect(ligne.statut).toBe("Rejetée");
    expect(ligne.decisionRH).toBe("Awa RH, 21/10/2026");
    expect(ligne.observationRH).toBe("Période de clôture");
  });
});


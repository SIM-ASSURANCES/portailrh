import { describe, expect, it } from "vitest";

import { destinatairesAnnulationConge } from "./congesNotifications";

describe("destinatairesAnnulationConge", () => {
  it("ancien statut VALIDEE : prévient tous les comptes RH (et le demandeur s'il n'est pas l'auteur)", () => {
    expect(
      destinatairesAnnulationConge({
        ancienStatut: "VALIDEE",
        acteurId: "sal-1",
        demandeurId: "sal-1",
        comptesRH: ["rh-1", "rh-2"],
        destinatairesEtapeEnCours: [],
      })
    ).toEqual(["rh-1", "rh-2"]);
  });

  it("ancien statut EN_ATTENTE_RESPONSABLE : prévient ceux qui devaient décider à cette étape", () => {
    expect(
      destinatairesAnnulationConge({
        ancienStatut: "EN_ATTENTE_RESPONSABLE",
        acteurId: "sal-1",
        demandeurId: "sal-1",
        comptesRH: ["rh-1"],
        destinatairesEtapeEnCours: ["resp-1"],
      })
    ).toEqual(["resp-1"]);
  });

  it("ancien statut EN_ATTENTE_RH : prévient ceux qui devaient décider à l'étape RH", () => {
    expect(
      destinatairesAnnulationConge({
        ancienStatut: "EN_ATTENTE_RH",
        acteurId: "sal-1",
        demandeurId: "sal-1",
        comptesRH: ["rh-1", "rh-2"],
        destinatairesEtapeEnCours: ["rh-1", "rh-2"],
      })
    ).toEqual(["rh-1", "rh-2"]);
  });

  it("ancien statut MODIFICATION_DEMANDEE : personne de plus que le demandeur (vide si le demandeur annule)", () => {
    expect(
      destinatairesAnnulationConge({
        ancienStatut: "MODIFICATION_DEMANDEE",
        acteurId: "sal-1",
        demandeurId: "sal-1",
        comptesRH: ["rh-1"],
        destinatairesEtapeEnCours: ["resp-1"],
      })
    ).toEqual([]);
  });

  it("demandeur qui annule : toujours absent de la liste des destinataires", () => {
    const res = destinatairesAnnulationConge({
      ancienStatut: "VALIDEE",
      acteurId: "sal-1",
      demandeurId: "sal-1",
      comptesRH: ["rh-1"],
      destinatairesEtapeEnCours: [],
    });
    expect(res).not.toContain("sal-1");
    expect(res).toEqual(["rh-1"]);
  });

  it("RH qui annule : le salarié est prévenu, la RH auteur est absente (les autres comptes RH restent prévenus sur VALIDEE)", () => {
    expect(
      destinatairesAnnulationConge({
        ancienStatut: "VALIDEE",
        acteurId: "rh-1",
        demandeurId: "sal-1",
        comptesRH: ["rh-1", "rh-2"],
        destinatairesEtapeEnCours: [],
      })
    ).toEqual(["sal-1", "rh-2"]);

    expect(
      destinatairesAnnulationConge({
        ancienStatut: "MODIFICATION_DEMANDEE",
        acteurId: "rh-1",
        demandeurId: "sal-1",
        comptesRH: ["rh-1"],
        destinatairesEtapeEnCours: [],
      })
    ).toEqual(["sal-1"]);
  });

  it("supprime les doublons parmi les destinataires", () => {
    expect(
      destinatairesAnnulationConge({
        ancienStatut: "EN_ATTENTE_RH",
        acteurId: "sal-1",
        demandeurId: "sal-1",
        comptesRH: ["rh-1", "rh-1"],
        destinatairesEtapeEnCours: ["rh-1", "rh-2", "rh-1"],
      })
    ).toEqual(["rh-1", "rh-2"]);
  });

  it("un compte RH qui est aussi le demandeur n'est prévenu qu'au titre de demandeur, sauf s'il est l'auteur", () => {
    // Une autre RH (rh-2) annule la demande de rh-1 : rh-1 n'apparaît qu'une seule fois
    expect(
      destinatairesAnnulationConge({
        ancienStatut: "VALIDEE",
        acteurId: "rh-2",
        demandeurId: "rh-1",
        comptesRH: ["rh-1", "rh-2"],
        destinatairesEtapeEnCours: [],
      })
    ).toEqual(["rh-1"]);

    // Sur MODIFICATION_DEMANDEE annulée par rh-2, rh-1 est prévenu uniquement au titre de demandeur
    expect(
      destinatairesAnnulationConge({
        ancienStatut: "MODIFICATION_DEMANDEE",
        acteurId: "rh-2",
        demandeurId: "rh-1",
        comptesRH: ["rh-1", "rh-2"],
        destinatairesEtapeEnCours: [],
      })
    ).toEqual(["rh-1"]);

    // Si rh-1 (demandeur et RH) annule lui-même : il est exclu, seule rh-2 est prévenue
    expect(
      destinatairesAnnulationConge({
        ancienStatut: "VALIDEE",
        acteurId: "rh-1",
        demandeurId: "rh-1",
        comptesRH: ["rh-1", "rh-2"],
        destinatairesEtapeEnCours: [],
      })
    ).toEqual(["rh-2"]);
  });
});


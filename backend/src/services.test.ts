import { describe, expect, it } from "vitest";

import { messageBlocageCreationDemande } from "./services";

describe("messageBlocageCreationDemande (création d'une demande)", () => {
  it("autorisée : service avec un responsable actif", () => {
    expect(messageBlocageCreationDemande({ serviceNom: "Commercial", responsableId: "u-1", responsableActif: true })).toBeNull();
  });

  it("refusée : compte sans service", () => {
    expect(messageBlocageCreationDemande({ serviceNom: null, responsableId: null, responsableActif: false })).toMatch(/aucun service/);
  });

  it("refusée : service sans responsable, avec le nom du service", () => {
    expect(messageBlocageCreationDemande({ serviceNom: "Marketing", responsableId: null, responsableActif: false })).toMatch(
      /« Marketing » n'a pas de responsable/
    );
  });

  it("refusée : responsable désactivé", () => {
    expect(messageBlocageCreationDemande({ serviceNom: "Technique", responsableId: "u-2", responsableActif: false })).toMatch(/désactivé/);
  });
});

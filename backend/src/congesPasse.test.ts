// B2 (consignes du 2026-10-16, art. 12 : « autorisation préalable ») : pas de congé dont le début est dans le passé.

import { describe, expect, it } from "vitest";

import { MESSAGE_CONGE_DANS_LE_PASSE, refusDateDebutPassee } from "./congesPasse";

describe("Date de début d'un congé : jamais dans le passé", () => {
  it("la veille est refusée, avec la phrase de l'écran", () => {
    expect(refusDateDebutPassee("2026-10-15", "2026-10-16")).toBe(MESSAGE_CONGE_DANS_LE_PASSE);
  });

  it("aujourd'hui et le futur sont acceptés", () => {
    expect(refusDateDebutPassee("2026-10-16", "2026-10-16")).toBeNull();
    expect(refusDateDebutPassee("2026-10-17", "2026-10-16")).toBeNull();
    expect(refusDateDebutPassee("2027-01-04", "2026-10-16")).toBeNull();
  });

  it("la phrase dit pourquoi et ce qu'il faut faire", () => {
    expect(MESSAGE_CONGE_DANS_LE_PASSE).toMatch(/passé/);
    expect(MESSAGE_CONGE_DANS_LE_PASSE).toMatch(/autorisation préalable/);
  });
});

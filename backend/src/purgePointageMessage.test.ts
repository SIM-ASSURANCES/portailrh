// B3 (consignes du 2026-10-16) : le message du refus de la purge du Pointage est le texte exact des consignes.
import { describe, expect, it, vi } from "vitest";

vi.mock("./prisma", () => ({ prisma: {} }));

import { MESSAGE_PURGE_REFUSEE_ABSENCES } from "./reinitialisationPointage";

describe("Purge du Pointage refusée : message", () => {
  it("dit la règle et ce qu'il faut faire, sans promettre qu'un traitement débloque la purge", () => {
    expect(MESSAGE_PURGE_REFUSEE_ABSENCES).toBe(
      "La purge du Pointage n'est plus possible dès qu'une demande de congé ou de permission existe : mettez le Pointage en service avant d'ouvrir les congés."
    );
    expect(MESSAGE_PURGE_REFUSEE_ABSENCES).not.toMatch(/Traitez/);
  });
});

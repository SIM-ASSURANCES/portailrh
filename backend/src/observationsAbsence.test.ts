// C3 (consignes du 2026-10-16) : observations de la RH (à sa décision) et du DG (à tout moment, sans changer le statut).

import { describe, expect, it } from "vitest";

import { peutConsulterAbsence, PERMISSION_DG_ABSENCE } from "./circuitAbsence";
import {
  LIBELLE_ETAPE_OBSERVATION,
  MESSAGE_OBSERVATION_DG_PROPRE_DEMANDE,
  MESSAGE_OBSERVATION_RESERVEE_DG,
  OBSERVATION_MAX,
  controlerObservation,
  refusObservationDG,
} from "./observationsAbsence";

describe("controlerObservation", () => {
  it("facultative : vide ou espaces → aucune observation", () => {
    expect(controlerObservation(undefined, true)).toEqual({ ok: true, texte: null });
    expect(controlerObservation("   ", true)).toEqual({ ok: true, texte: null });
    expect(controlerObservation(null, true)).toEqual({ ok: true, texte: null });
  });

  it("obligatoire (observation du DG) : vide refusée", () => {
    const r = controlerObservation("  ", false);
    expect(r.ok).toBe(false);
  });

  it("nettoie les espaces et garde le texte", () => {
    expect(controlerObservation("  À  suivre \n de près ", true)).toEqual({ ok: true, texte: "À suivre de près" });
  });

  it("500 caractères au plus", () => {
    expect(controlerObservation("a".repeat(OBSERVATION_MAX), true)).toEqual({ ok: true, texte: "a".repeat(OBSERVATION_MAX) });
    const r = controlerObservation("a".repeat(OBSERVATION_MAX + 1), true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur).toMatch(/500/);
  });

  it("refuse ce qui n'est pas du texte", () => {
    expect(controlerObservation(42 as unknown, true).ok).toBe(false);
  });
});

describe("refusObservationDG : le DG, sur le RÔLE, jamais pour sa propre demande", () => {
  const dg = { id: "dg", rolePermissions: [PERMISSION_DG_ABSENCE] };
  it("le DG peut observer la demande d'un autre", () => {
    expect(refusObservationDG({ acteur: dg, demandeurId: "collab" })).toBeNull();
  });
  it("un autre compte (même RH) ne peut pas", () => {
    expect(refusObservationDG({ acteur: { id: "rh", rolePermissions: ["conges.valider_rh"] }, demandeurId: "collab" })).toBe(MESSAGE_OBSERVATION_RESERVEE_DG);
  });
  it("jamais pour sa propre demande", () => {
    expect(refusObservationDG({ acteur: dg, demandeurId: "dg" })).toBe(MESSAGE_OBSERVATION_DG_PROPRE_DEMANDE);
  });
});

describe("Le DG voit toutes les demandes sans consulter_tous", () => {
  const base = { acteurId: "dg", demandeurId: "collab", responsableDuServiceId: "resp" };
  it("lecture accordée au DG (permission du rôle) pour un congé", () => {
    expect(peutConsulterAbsence({ ...base, nature: "CONGE", permissions: [PERMISSION_DG_ABSENCE] })).toBe(true);
  });
  it("un compte sans aucun droit ne voit pas la demande d'un autre", () => {
    expect(peutConsulterAbsence({ ...base, nature: "CONGE", permissions: [] })).toBe(false);
  });
});

describe("Libellés", () => {
  it("nomment les trois étapes", () => {
    expect(LIBELLE_ETAPE_OBSERVATION).toEqual({ RESPONSABLE: "Responsable du service", RH: "RH", DG: "DG" });
  });
});

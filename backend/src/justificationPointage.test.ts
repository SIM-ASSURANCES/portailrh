import { describe, expect, it } from "vitest";

import {
  MESSAGE_PROPRE_JUSTIFICATION,
  MESSAGE_RESERVE_RESPONSABLE,
  MESSAGE_RESERVE_RH,
  descriptionAnomalie,
  messageDecisionJustification,
  messageSoumissionJustification,
  nettoyerMotif,
  peutSoumettreJustification,
  presentationCollaborateur,
  refusDecideur,
  resoudreDecideurJustification,
  serviceCollaborateurDepuis,
  transitionJustification,
  type DecideurJustification,
} from "./justificationPointage";
import { PERMISSION_RH_POINTAGE } from "./pointage-utils";

const COMMERCIAL = { name: "Commercial", responsableId: "resp", responsableActif: true };
/** Un compte RH actif distinct du collaborateur (cas courant). */
const AUTRE_RH = ["rh"];

describe("resoudreDecideurJustification", () => {
  it("collaborateur d'un service avec responsable actif : le responsable", () => {
    expect(resoudreDecideurJustification({ comptesRH: AUTRE_RH, collaborateurId: "collab", service: COMMERCIAL })).toEqual({
      type: "RESPONSABLE",
      responsableId: "resp",
    });
  });

  it("aucun service : la RH", () => {
    expect(resoudreDecideurJustification({ comptesRH: AUTRE_RH, collaborateurId: "collab", service: null })).toEqual({
      type: "RH",
      raison: "SANS_SERVICE",
    });
  });

  it("service sans responsable : la RH", () => {
    expect(
      resoudreDecideurJustification({ comptesRH: AUTRE_RH, collaborateurId: "collab", service: { ...COMMERCIAL, responsableId: null } })
    ).toEqual({ type: "RH", raison: "SANS_RESPONSABLE" });
  });

  it("responsable désactivé : la RH", () => {
    expect(
      resoudreDecideurJustification({ comptesRH: AUTRE_RH, collaborateurId: "collab", service: { ...COMMERCIAL, responsableActif: false } })
    ).toEqual({ type: "RH", raison: "RESPONSABLE_INACTIF" });
  });

  it("le collaborateur est le responsable de son service (DG compris) : la RH", () => {
    expect(resoudreDecideurJustification({ comptesRH: AUTRE_RH, collaborateurId: "resp", service: COMMERCIAL })).toEqual({
      type: "RH",
      raison: "EST_RESPONSABLE",
    });
    // Responsable désactivé ET lui-même : on dit d'abord qu'il est le responsable.
    expect(
      resoudreDecideurJustification({ comptesRH: AUTRE_RH, collaborateurId: "resp", service: { ...COMMERCIAL, responsableActif: false } })
    ).toEqual({ type: "RH", raison: "EST_RESPONSABLE" });
  });

  it("adapte le service chargé par chargerServiceDuDemandeur", () => {
    expect(serviceCollaborateurDepuis({ serviceNom: null, responsableId: null, responsableActif: false })).toBeNull();
    expect(
      serviceCollaborateurDepuis({ serviceNom: "Commercial", responsableId: "resp", responsableActif: true })
    ).toEqual(COMMERCIAL);
  });
});

describe("refusDecideur", () => {
  const responsable: DecideurJustification = { type: "RESPONSABLE", responsableId: "resp" };
  const rh: DecideurJustification = { type: "RH", raison: "EST_RESPONSABLE" };

  it("cas responsable : seul le responsable actuel décide", () => {
    expect(refusDecideur(responsable, { id: "resp", rolePermissions: [] }, "collab")).toBeNull();
    expect(refusDecideur(responsable, { id: "autre", rolePermissions: [] }, "collab")).toBe(MESSAGE_RESERVE_RESPONSABLE);
    // La RH ne décide pas à la place d'un responsable présent.
    expect(refusDecideur(responsable, { id: "rh", rolePermissions: [PERMISSION_RH_POINTAGE] }, "collab")).toBe(
      MESSAGE_RESERVE_RESPONSABLE
    );
  });

  it("cas RH : la permission RH du pointage suffit", () => {
    expect(refusDecideur(rh, { id: "rh", rolePermissions: [PERMISSION_RH_POINTAGE] }, "collab")).toBeNull();
    expect(refusDecideur(rh, { id: "x", rolePermissions: ["pointage.pointer"] }, "collab")).toBe(MESSAGE_RESERVE_RH);
  });

  it("jamais le collaborateur lui-même, même avec la permission RH", () => {
    expect(refusDecideur(rh, { id: "collab", rolePermissions: [PERMISSION_RH_POINTAGE] }, "collab")).toBe(
      MESSAGE_PROPRE_JUSTIFICATION
    );
    expect(refusDecideur({ type: "RESPONSABLE", responsableId: "collab" }, { id: "collab", rolePermissions: [] }, "collab")).toBe(
      MESSAGE_PROPRE_JUSTIFICATION
    );
  });
});

describe("transitionJustification", () => {
  it("soumission depuis EN_ATTENTE et NON_JUSTIFIEE, motif nettoyé", () => {
    expect(transitionJustification("EN_ATTENTE", { type: "SOUMETTRE", motif: "  Embouteillage\n  au pont  " })).toEqual({
      ok: true,
      statut: "SOUMISE",
      motif: "Embouteillage au pont",
    });
    expect(transitionJustification("NON_JUSTIFIEE", { type: "SOUMETTRE", motif: "Panne" })).toMatchObject({
      ok: true,
      statut: "SOUMISE",
    });
  });

  it("motif de 3 à 500 caractères après nettoyage", () => {
    expect(transitionJustification("EN_ATTENTE", { type: "SOUMETTRE", motif: "  ab  " })).toMatchObject({ ok: false });
    expect(transitionJustification("EN_ATTENTE", { type: "SOUMETTRE", motif: "abc" })).toMatchObject({ ok: true });
    expect(transitionJustification("EN_ATTENTE", { type: "SOUMETTRE", motif: "a".repeat(500) })).toMatchObject({ ok: true });
    expect(transitionJustification("EN_ATTENTE", { type: "SOUMETTRE", motif: "a".repeat(501) })).toMatchObject({
      ok: false,
    });
  });

  it("soumission refusée une fois envoyée ou décidée", () => {
    for (const statut of ["SOUMISE", "ACCEPTEE", "REFUSEE"] as const) {
      expect(transitionJustification(statut, { type: "SOUMETTRE", motif: "Bouchon" })).toMatchObject({ ok: false });
      expect(peutSoumettreJustification(statut)).toBe(false);
    }
    expect(peutSoumettreJustification("EN_ATTENTE")).toBe(true);
    expect(peutSoumettreJustification("NON_JUSTIFIEE")).toBe(true);
  });

  it("décision seulement depuis SOUMISE", () => {
    expect(transitionJustification("SOUMISE", { type: "ACCEPTER" })).toEqual({ ok: true, statut: "ACCEPTEE" });
    expect(transitionJustification("SOUMISE", { type: "REFUSER", motifRefus: " Pas crédible " })).toEqual({
      ok: true,
      statut: "REFUSEE",
      motifRefus: "Pas crédible",
    });
    for (const statut of ["EN_ATTENTE", "NON_JUSTIFIEE", "ACCEPTEE", "REFUSEE"] as const) {
      expect(transitionJustification(statut, { type: "ACCEPTER" })).toMatchObject({ ok: false });
      expect(transitionJustification(statut, { type: "REFUSER", motifRefus: "Non" + "n" })).toMatchObject({ ok: false });
    }
  });

  it("refus : motif d'au moins 3 caractères", () => {
    expect(transitionJustification("SOUMISE", { type: "REFUSER", motifRefus: "  " })).toMatchObject({ ok: false });
    expect(transitionJustification("SOUMISE", { type: "REFUSER", motifRefus: "ab" })).toMatchObject({ ok: false });
    expect(transitionJustification("SOUMISE", { type: "REFUSER", motifRefus: "abc" })).toMatchObject({ ok: true });
  });

  it("nettoyerMotif", () => {
    expect(nettoyerMotif("\t a \n\n b ")).toBe("a b");
  });
});

describe("messages", () => {
  const retard = { type: "ARRIVEE" as const, heure: new Date(2026, 9, 12, 8, 10), minutesRetard: 25 };
  const depart = { type: "DEPART" as const, heure: new Date(2026, 9, 12, 15, 0), minutesRetard: null };

  it("description du retard et du départ anticipé", () => {
    expect(descriptionAnomalie(retard)).toBe("retard de 25 min le 12/10/2026 (arrivée à 08:10)");
    expect(descriptionAnomalie(depart)).toBe("départ anticipé le 12/10/2026 à 15:00");
  });

  it("soumission au responsable", () => {
    const m = messageSoumissionJustification({
      collaborateurNom: "Awa Koné",
      serviceNom: "Commercial",
      decideur: { type: "RESPONSABLE", responsableId: "resp" },
      pointage: retard,
      motif: "Embouteillage",
    });
    expect(m.titre).toBe("Justification de retard à examiner");
    expect(m.message).toBe(
      "Awa Koné a justifié son retard de 25 min le 12/10/2026 (arrivée à 08:10) : « Embouteillage ». Décision attendue de votre part."
    );
  });

  it("soumission à la RH : variante « responsable du service »", () => {
    const m = messageSoumissionJustification({
      collaborateurNom: "Responsable Commercial",
      serviceNom: "Commercial",
      decideur: { type: "RH", raison: "EST_RESPONSABLE" },
      pointage: depart,
      motif: "Rendez-vous médical",
    });
    expect(m.titre).toBe("Justification de départ à examiner");
    expect(m.message).toBe(
      "Responsable Commercial, responsable du service Commercial, a justifié son départ anticipé le 12/10/2026 à 15:00 : « Rendez-vous médical ». Décision attendue de la RH."
    );
  });

  it("présentation pour chaque raison RH", () => {
    expect(presentationCollaborateur("X", null, { type: "RH", raison: "SANS_SERVICE" })).toBe("X (rattaché à aucun service)");
    expect(presentationCollaborateur("X", "RH", { type: "RH", raison: "SANS_RESPONSABLE" })).toBe(
      "X (service RH, sans responsable)"
    );
    expect(presentationCollaborateur("X", "RH", { type: "RH", raison: "RESPONSABLE_INACTIF" })).toBe(
      "X (service RH, responsable désactivé)"
    );
  });

  it("décision au collaborateur, avec le motif du refus", () => {
    expect(
      messageDecisionJustification({ pointage: retard, statut: "ACCEPTEE", decideurNom: "Resp" }).message
    ).toBe("Votre justification du retard de 25 min le 12/10/2026 (arrivée à 08:10) a été acceptée par Resp.");
    const refus = messageDecisionJustification({
      pointage: depart,
      statut: "REFUSEE",
      decideurNom: "RH Test",
      motifRefus: "Aucun justificatif",
    });
    expect(refus.titre).toBe("Justification rejetée");
    expect(refus.message).toBe(
      "Votre justification du départ anticipé le 12/10/2026 à 15:00 a été rejetée par RH Test. Motif : Aucun justificatif"
    );
  });
});

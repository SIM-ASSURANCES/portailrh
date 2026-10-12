import { describe, expect, it } from "vitest";

import { PERMISSIONS_DECISION_NON_DELEGABLES } from "./circuitDemande";
import {
  MESSAGE_PROPRE_JUSTIFICATION,
  MESSAGE_RESERVE_DG,
  MESSAGE_RESERVE_RESPONSABLE,
  MESSAGE_RESERVE_RH,
  PERMISSION_DG_JUSTIFICATION,
  destinatairesDecideur,
  libelleDecideur,
  messageAlerteDecideurJustification,
  messageSoumissionJustification,
  refusDecideur,
  resoudreDecideurJustification,
  type DecideurJustification,
} from "./justificationPointage";
import { PERMISSION_RH_POINTAGE } from "./pointage-utils";

// Décision des justifications de pointage, trois niveaux (2026-10-12) : responsable du service, sinon un autre compte
// RH actif, sinon le DG. Personne ne décide sa propre justification.
const COMMERCIAL = { name: "Commercial", responsableId: "resp", responsableActif: true };
const SERVICE_RH = { name: "RH", responsableId: "rh1", responsableActif: true };
const RH = [PERMISSION_RH_POINTAGE];
const DG = [PERMISSION_DG_JUSTIFICATION];
const pointage = { type: "ARRIVEE" as const, heure: new Date(2026, 9, 12, 8, 10), minutesRetard: 25 };

describe("resoudreDecideurJustification : les trois niveaux", () => {
  it("niveau 1 : le responsable actif du service, même s'il existe des comptes RH", () => {
    expect(resoudreDecideurJustification({ collaborateurId: "collab", service: COMMERCIAL, comptesRH: ["rh1"] })).toEqual({
      type: "RESPONSABLE",
      responsableId: "resp",
    });
  });

  it("niveau 2 : le collaborateur est le responsable de son service, un autre compte RH existe", () => {
    expect(resoudreDecideurJustification({ collaborateurId: "resp", service: COMMERCIAL, comptesRH: ["rh1"] })).toEqual({
      type: "RH",
      raison: "EST_RESPONSABLE",
    });
  });

  it("niveau 2 : un RH en retard est décidé par un autre RH", () => {
    expect(
      resoudreDecideurJustification({ collaborateurId: "rh1", service: SERVICE_RH, comptesRH: ["rh1", "rh2"] })
    ).toEqual({ type: "RH", raison: "EST_RESPONSABLE" });
  });

  it("niveau 3 : le retardataire est le seul compte RH, le DG décide", () => {
    expect(resoudreDecideurJustification({ collaborateurId: "rh1", service: SERVICE_RH, comptesRH: ["rh1"] })).toEqual({
      type: "DG",
      raison: "EST_RESPONSABLE",
    });
  });

  it("niveau 3 : aucun compte RH actif, quelle que soit la raison", () => {
    expect(resoudreDecideurJustification({ collaborateurId: "collab", service: null, comptesRH: [] })).toEqual({
      type: "DG",
      raison: "SANS_SERVICE",
    });
    expect(
      resoudreDecideurJustification({
        collaborateurId: "collab",
        service: { ...COMMERCIAL, responsableActif: false },
        comptesRH: [],
      })
    ).toEqual({ type: "DG", raison: "RESPONSABLE_INACTIF" });
  });
});

describe("refusDecideur : jamais soi-même, à aucun niveau", () => {
  const responsable: DecideurJustification = { type: "RESPONSABLE", responsableId: "resp" };
  const rh: DecideurJustification = { type: "RH", raison: "EST_RESPONSABLE" };
  const dg: DecideurJustification = { type: "DG", raison: "EST_RESPONSABLE" };

  it("le collaborateur ne décide jamais, même avec toutes les permissions", () => {
    const tout = { id: "collab", permissions: [...RH, ...DG] };
    for (const d of [responsable, rh, dg]) expect(refusDecideur(d, tout, "collab")).toBe(MESSAGE_PROPRE_JUSTIFICATION);
  });

  it("niveau RH : un compte RH décide, le DG non", () => {
    expect(refusDecideur(rh, { id: "rh2", permissions: RH }, "rh1")).toBeNull();
    expect(refusDecideur(rh, { id: "dg", permissions: DG }, "rh1")).toBe(MESSAGE_RESERVE_RH);
  });

  it("niveau DG : le DG décide, un autre compte non", () => {
    expect(refusDecideur(dg, { id: "dg", permissions: DG }, "rh1")).toBeNull();
    expect(refusDecideur(dg, { id: "collab2", permissions: [] }, "rh1")).toBe(MESSAGE_RESERVE_DG);
  });

  it("niveau responsable : ni la RH ni le DG à la place du responsable", () => {
    expect(refusDecideur(responsable, { id: "rh1", permissions: RH }, "collab")).toBe(MESSAGE_RESERVE_RESPONSABLE);
    expect(refusDecideur(responsable, { id: "dg", permissions: DG }, "collab")).toBe(MESSAGE_RESERVE_RESPONSABLE);
  });

  it("le DG retardataire, seul à pouvoir décider au dernier niveau, ne décide pas sa propre justification", () => {
    expect(refusDecideur(dg, { id: "dg", permissions: [...DG, ...RH] }, "dg")).toBe(MESSAGE_PROPRE_JUSTIFICATION);
  });

  it("la permission du DG n'est jamais délégable : un délégué ne peut pas décider au dernier niveau", () => {
    expect(PERMISSIONS_DECISION_NON_DELEGABLES).toContain(PERMISSION_DG_JUSTIFICATION);
  });
});

describe("notifications : mêmes règles que la décision", () => {
  it("responsable : lui seul", () => {
    expect(destinatairesDecideur({ type: "RESPONSABLE", responsableId: "resp" }, "collab")).toEqual({
      type: "COMPTE",
      userId: "resp",
    });
  });

  it("RH : les comptes RH sauf le collaborateur ; le DG n'est pas notifié", () => {
    expect(destinatairesDecideur({ type: "RH", raison: "EST_RESPONSABLE" }, "resp")).toEqual({
      type: "PERMISSION",
      permission: PERMISSION_RH_POINTAGE,
      exclureUserId: "resp",
    });
  });

  it("repli DG : le DG, jamais le collaborateur", () => {
    expect(destinatairesDecideur({ type: "DG", raison: "EST_RESPONSABLE" }, "rh1")).toEqual({
      type: "PERMISSION",
      permission: PERMISSION_DG_JUSTIFICATION,
      exclureUserId: "rh1",
    });
  });

  it("textes du repli DG", () => {
    const dg: DecideurJustification = { type: "DG", raison: "EST_RESPONSABLE" };
    const soumission = messageSoumissionJustification({
      collaborateurNom: "Awa",
      serviceNom: "RH",
      decideur: dg,
      pointage,
      motif: "Embouteillage",
    });
    expect(soumission.message).toContain("Awa, responsable du service RH, a justifié son retard de 25 min");
    expect(soumission.message).toContain("Aucun autre compte RH ne peut décider");
    const alerte = messageAlerteDecideurJustification({ collaborateurNom: "Awa", serviceNom: "RH", decideur: dg, pointage });
    expect(alerte.message).toContain("Aucun autre compte RH ne peut décider");
    expect(libelleDecideur(dg, null)).toBe("le DG");
  });
});

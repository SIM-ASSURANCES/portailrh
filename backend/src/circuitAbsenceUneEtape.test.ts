// C4 (consignes du 2026-10-16) : une permission EXCEPTIONNELLE (mariage, décès, naissance…) se décide en UNE SEULE étape,
// par le destinataire que le demandeur a choisi (son responsable ou la RH). Décision définitive : VALIDEE ou REJETEE.

import { describe, expect, it } from "vitest";

import {
  MESSAGE_DESTINATAIRE_HORS_PERMISSION_EXCEPTIONNELLE,
  MESSAGE_DESTINATAIRE_NON_PROPOSE,
  MESSAGE_DESTINATAIRE_OBLIGATOIRE,
  actionsPossiblesAbsence,
  controlerDestinataire,
  decideurPourStatutAbsence,
  destinatairesEtapeAbsence,
  destinatairesProposes,
  friseAbsence,
  resoudreParcoursAbsence,
  transitionAbsence,
  type ContexteCircuitAbsence,
} from "./circuitAbsence";

const DEMANDEUR = "collab";
const RESP = "resp";
const RH1 = "rh1";
const DG = "dg";

function ctx(over: Partial<ContexteCircuitAbsence> & { responsableActif?: boolean } = {}): ContexteCircuitAbsence {
  const { responsableActif, ...reste } = over;
  return {
    demandeurId: DEMANDEUR,
    service: { name: "Commercial", responsableId: RESP, responsableActif: responsableActif ?? true },
    comptesRH: [RH1],
    comptesDG: [DG],
    ...reste,
  };
}

describe("Destinataires proposés au demandeur", () => {
  it("responsable utilisable : son responsable ou la RH", () => {
    expect(destinatairesProposes(ctx())).toEqual(["RESPONSABLE", "RH"]);
  });

  it.each([
    ["sans service", { service: null }],
    ["service sans responsable", { service: { name: "X", responsableId: null, responsableActif: false } }],
    ["responsable désactivé", { responsableActif: false }],
    ["il est lui-même le responsable", { service: { name: "X", responsableId: DEMANDEUR, responsableActif: true } }],
    ["demandeur DG", { comptesDG: [DEMANDEUR, DG] }],
  ] as const)("%s : seule « La RH » est proposée", (_nom, over) => {
    expect(destinatairesProposes(ctx(over as Partial<ContexteCircuitAbsence>))).toEqual(["RH"]);
  });
});

describe("Choix du destinataire : le serveur refuse ce qui n'est pas proposé", () => {
  it("permission exceptionnelle : le choix est obligatoire", () => {
    const r = controlerDestinataire({ choix: undefined, exceptionnelle: true, ctx: ctx() });
    expect(r).toEqual({ ok: false, erreur: MESSAGE_DESTINATAIRE_OBLIGATOIRE });
  });
  it("accepte l'un des deux choix proposés", () => {
    expect(controlerDestinataire({ choix: "RESPONSABLE", exceptionnelle: true, ctx: ctx() })).toEqual({ ok: true, destinataire: "RESPONSABLE" });
    expect(controlerDestinataire({ choix: "RH", exceptionnelle: true, ctx: ctx() })).toEqual({ ok: true, destinataire: "RH" });
  });
  it("refuse « responsable » quand il n'est pas utilisable", () => {
    const r = controlerDestinataire({ choix: "RESPONSABLE", exceptionnelle: true, ctx: ctx({ responsableActif: false }) });
    expect(r).toEqual({ ok: false, erreur: MESSAGE_DESTINATAIRE_NON_PROPOSE });
  });
  it("refuse une valeur inconnue", () => {
    expect(controlerDestinataire({ choix: "DG", exceptionnelle: true, ctx: ctx() })).toEqual({ ok: false, erreur: MESSAGE_DESTINATAIRE_NON_PROPOSE });
  });
  it("type ordinaire : aucun choix, circuit habituel ; un choix fourni est refusé", () => {
    expect(controlerDestinataire({ choix: undefined, exceptionnelle: false, ctx: ctx() })).toEqual({ ok: true, destinataire: null });
    expect(controlerDestinataire({ choix: null, exceptionnelle: false, ctx: ctx() })).toEqual({ ok: true, destinataire: null });
    expect(controlerDestinataire({ choix: "RH", exceptionnelle: false, ctx: ctx() })).toEqual({ ok: false, erreur: MESSAGE_DESTINATAIRE_HORS_PERMISSION_EXCEPTIONNELLE });
  });
});

describe("Parcours en une étape", () => {
  it("choix « responsable » : la demande attend le responsable, la RH n'est pas une étape", () => {
    const p = resoudreParcoursAbsence(ctx(), "RESPONSABLE");
    expect(p.ok && p.premierStatut).toBe("EN_ATTENTE_RESPONSABLE");
    expect(p.ok && p.etapeUnique).toBe(true);
    expect(destinatairesEtapeAbsence("EN_ATTENTE_RESPONSABLE", ctx())).toEqual([RESP]);
  });
  it("choix « RH » : la demande attend la RH, l'étape responsable n'est pas requise", () => {
    const p = resoudreParcoursAbsence(ctx(), "RH");
    expect(p.ok && p.premierStatut).toBe("EN_ATTENTE_RH");
    expect(p.ok && p.etapeResponsable.requise).toBe(false);
    expect(p.ok && p.etapeUnique).toBe(true);
    expect(destinatairesEtapeAbsence("EN_ATTENTE_RH", ctx())).toEqual([RH1]);
  });
  it("circuit ordinaire inchangé (aucun destinataire)", () => {
    const p = resoudreParcoursAbsence(ctx());
    expect(p.ok && p.premierStatut).toBe("EN_ATTENTE_RESPONSABLE");
    expect(p.ok && p.etapeUnique).toBe(false);
  });
  it("aucun décideur possible : refusé dès la soumission, même avec un choix", () => {
    const p = resoudreParcoursAbsence(ctx({ comptesRH: [], comptesDG: [] }), "RH");
    expect(p.ok).toBe(false);
  });
});

describe("Décision unique et définitive", () => {
  const base = { nature: "CONGE" as const, demandeurId: DEMANDEUR, etapeUnique: true };

  it("le responsable choisi accorde : VALIDEE tout de suite, avec le débit éventuel et les plages (ACCORDER)", () => {
    const r = transitionAbsence({ ...base, statut: "EN_ATTENTE_RESPONSABLE", action: { type: "APPROUVER" }, acteur: { id: RESP, rolePermissions: [] }, decideur: decideurPourStatutAbsence("EN_ATTENTE_RESPONSABLE", ctx()) });
    expect(r).toMatchObject({ ok: true, statut: "VALIDEE", effet: "ACCORDER", etape: "RESPONSABLE" });
  });
  it("le même circuit sans étape unique envoie au contraire à la RH (non-régression)", () => {
    const r = transitionAbsence({ ...base, etapeUnique: false, statut: "EN_ATTENTE_RESPONSABLE", action: { type: "APPROUVER" }, acteur: { id: RESP, rolePermissions: [] }, decideur: decideurPourStatutAbsence("EN_ATTENTE_RESPONSABLE", ctx()) });
    expect(r).toMatchObject({ ok: true, statut: "EN_ATTENTE_RH", effet: "AUCUN" });
  });
  it("le responsable choisi rejette : REJETEE, motif obligatoire", () => {
    const acteur = { id: RESP, rolePermissions: [] };
    const decideur = decideurPourStatutAbsence("EN_ATTENTE_RESPONSABLE", ctx());
    expect(transitionAbsence({ ...base, statut: "EN_ATTENTE_RESPONSABLE", action: { type: "REJETER", motif: "Pièce illisible" }, acteur, decideur })).toMatchObject({ ok: true, statut: "REJETEE" });
    expect(transitionAbsence({ ...base, statut: "EN_ATTENTE_RESPONSABLE", action: { type: "REJETER", motif: "" }, acteur, decideur }).ok).toBe(false);
  });
  it("la RH choisie accorde : VALIDEE", () => {
    const r = transitionAbsence({ ...base, statut: "EN_ATTENTE_RH", action: { type: "APPROUVER" }, acteur: { id: RH1, rolePermissions: ["conges.valider_rh"] }, decideur: decideurPourStatutAbsence("EN_ATTENTE_RH", ctx()) });
    expect(r).toMatchObject({ ok: true, statut: "VALIDEE", effet: "ACCORDER" });
  });
  it("seul le destinataire décide : la RH ne décide pas à la place d'un responsable utilisable", () => {
    const r = transitionAbsence({ ...base, statut: "EN_ATTENTE_RESPONSABLE", action: { type: "APPROUVER" }, acteur: { id: RH1, rolePermissions: ["conges.valider_rh"] }, decideur: decideurPourStatutAbsence("EN_ATTENTE_RESPONSABLE", ctx()) });
    expect(r.ok).toBe(false);
  });
  it("jamais le demandeur", () => {
    const r = transitionAbsence({ ...base, statut: "EN_ATTENTE_RESPONSABLE", action: { type: "APPROUVER" }, acteur: { id: DEMANDEUR, rolePermissions: ["conges.valider_rh"] }, decideur: decideurPourStatutAbsence("EN_ATTENTE_RESPONSABLE", ctx()) });
    expect(r.ok).toBe(false);
  });
  it("les boutons grisés suivent la même règle (phrase du serveur)", () => {
    const a = actionsPossiblesAbsence({ ...base, statut: "EN_ATTENTE_RESPONSABLE", acteur: { id: RH1, rolePermissions: ["conges.valider_rh"] }, decideur: decideurPourStatutAbsence("EN_ATTENTE_RESPONSABLE", ctx()) });
    expect(a.approuver).not.toBeNull();
  });
});

describe("Repli quand le destinataire devient indisponible (jamais le demandeur)", () => {
  const base = { nature: "CONGE" as const, demandeurId: DEMANDEUR, etapeUnique: true, statut: "EN_ATTENTE_RESPONSABLE" as const };

  it("responsable choisi puis désactivé : la RH décide à sa place, VALIDEE (accord par repli)", () => {
    const c = ctx({ responsableActif: false });
    const decideur = decideurPourStatutAbsence("EN_ATTENTE_RESPONSABLE", c);
    expect(decideur).toMatchObject({ type: "RH", repli: true });
    const r = transitionAbsence({ ...base, action: { type: "APPROUVER" }, acteur: { id: RH1, rolePermissions: ["conges.valider_rh"] }, decideur });
    expect(r).toMatchObject({ ok: true, statut: "VALIDEE", effet: "ACCORDER", viaRepli: true });
    expect(destinatairesEtapeAbsence("EN_ATTENTE_RESPONSABLE", c)).toEqual([RH1]);
  });
  it("responsable désactivé et aucune RH : le DG", () => {
    const c = ctx({ responsableActif: false, comptesRH: [] });
    expect(decideurPourStatutAbsence("EN_ATTENTE_RESPONSABLE", c)).toMatchObject({ type: "DG" });
    expect(destinatairesEtapeAbsence("EN_ATTENTE_RESPONSABLE", c)).toEqual([DG]);
  });
  it("RH choisie et seul compte RH = le demandeur : le DG décide, jamais le demandeur", () => {
    const c = ctx({ comptesRH: [DEMANDEUR] });
    expect(decideurPourStatutAbsence("EN_ATTENTE_RH", c)).toMatchObject({ type: "DG" });
    expect(destinatairesEtapeAbsence("EN_ATTENTE_RH", c)).toEqual([DG]);
  });
});

describe("Frise d'une permission exceptionnelle", () => {
  it("choix « responsable » : la RH n'est pas une étape", () => {
    const f = friseAbsence({ nature: "CONGE", statut: "EN_ATTENTE_RESPONSABLE", etapeResponsableRequise: true, etapeRHRequise: false });
    expect(f.find((e) => e.cle === "RESPONSABLE")?.etat).toBe("en_cours");
    expect(f.find((e) => e.cle === "RH")?.etat).toBe("non_requise");
  });
  it("choix « RH » : l'étape responsable n'est pas requise", () => {
    const f = friseAbsence({ nature: "CONGE", statut: "EN_ATTENTE_RH", etapeResponsableRequise: false });
    expect(f.find((e) => e.cle === "RESPONSABLE")?.etat).toBe("non_requise");
    expect(f.find((e) => e.cle === "RH")?.etat).toBe("en_cours");
  });
  it("accordée par le responsable : responsable fait, RH non requise, décision faite", () => {
    const f = friseAbsence({ nature: "CONGE", statut: "VALIDEE", etapeResponsableRequise: true, etapeRHRequise: false });
    expect(f.map((e) => e.etat)).toEqual(["faite", "faite", "non_requise", "faite"]);
  });
});

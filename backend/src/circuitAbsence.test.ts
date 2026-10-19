import { describe, expect, it } from "vitest";
import {
  ACTION_HISTORIQUE_ABSENCE,
  MESSAGE_AUCUN_DECIDEUR,
  MESSAGE_PROPRE_DEMANDE_ABSENCE,
  MESSAGE_RESERVE_DG_ABSENCE,
  MESSAGE_RESERVE_RESPONSABLE_ABSENCE,
  MESSAGE_RESERVE_RH_ABSENCE,
  actionsPossiblesAbsence,
  decideurPourStatutAbsence,
  destinatairesEtapeAbsence,
  estStatutFinalAccorde,
  friseAbsence,
  nettoyerMotifAbsence,
  refusDecideurAbsence,
  resoudreParcoursAbsence,
  transitionAbsence,
  type ActeurAbsence,
  type ContexteCircuitAbsence,
  type StatutCircuitAbsence,
} from "./circuitAbsence";

const DEMANDEUR = "u-demandeur";
const RESP = "u-resp";
const RH1 = "u-rh1";
const RH2 = "u-rh2";
const DG = "u-dg";

function ctx(over: Partial<ContexteCircuitAbsence> = {}): ContexteCircuitAbsence {
  return {
    demandeurId: DEMANDEUR,
    service: { name: "Commercial", responsableId: RESP, responsableActif: true },
    comptesRH: [RH1],
    comptesDG: [DG],
    ...over,
  };
}

const acteur = (id: string, ...rolePermissions: string[]): ActeurAbsence => ({ id, rolePermissions });
const rh = (id = RH1) => acteur(id, "conges.valider_rh");

function param(statut: StatutCircuitAbsence, c: ContexteCircuitAbsence) {
  return { nature: "CONGE" as const, statut, demandeurId: c.demandeurId, decideur: decideurPourStatutAbsence(statut, c) };
}

describe("résolution du parcours", () => {
  it("cas courant : le responsable d'abord, puis la RH", () => {
    const p = resoudreParcoursAbsence(ctx());
    expect(p).toMatchObject({ ok: true, premierStatut: "EN_ATTENTE_RESPONSABLE", etapeRH: { type: "RH" } });
  });

  it("demandeur responsable de son service : étape responsable non requise, directement la RH", () => {
    const p = resoudreParcoursAbsence(
      ctx({ service: { name: "Commercial", responsableId: DEMANDEUR, responsableActif: true } })
    );
    expect(p).toMatchObject({
      ok: true,
      premierStatut: "EN_ATTENTE_RH",
      etapeResponsable: { requise: false, raison: "EST_RESPONSABLE" },
    });
  });

  it("demandeur DG : étape responsable non requise ; la RH décide s'il y a un autre compte RH", () => {
    const p = resoudreParcoursAbsence(ctx({ comptesDG: [DEMANDEUR, DG] }));
    expect(p).toMatchObject({ ok: true, premierStatut: "EN_ATTENTE_RH", etapeRH: { type: "RH" } });
    expect(p.ok && p.etapeResponsable).toEqual({ requise: false, raison: "DEMANDEUR_DG" });
  });

  it.each([
    ["sans service", null, "SANS_SERVICE"],
    ["sans responsable", { name: "X", responsableId: null, responsableActif: false }, "SANS_RESPONSABLE"],
    ["responsable désactivé", { name: "X", responsableId: RESP, responsableActif: false }, "RESPONSABLE_INACTIF"],
  ] as const)("%s : l'étape responsable n'est pas requise", (_nom, service, raison) => {
    const p = resoudreParcoursAbsence(ctx({ service }));
    expect(p).toMatchObject({ ok: true, premierStatut: "EN_ATTENTE_RH" });
    expect(p.ok && p.etapeResponsable).toEqual({ requise: false, raison });
  });

  it("demandeur RH sans autre compte RH : le DG décide à l'étape RH", () => {
    const p = resoudreParcoursAbsence(ctx({ demandeurId: RH1, comptesRH: [RH1] }));
    expect(p).toMatchObject({ ok: true, etapeRH: { type: "DG" } });
  });

  it("demandeur RH avec un autre compte RH : la RH décide", () => {
    const p = resoudreParcoursAbsence(ctx({ demandeurId: RH1, comptesRH: [RH1, RH2] }));
    expect(p).toMatchObject({ ok: true, etapeRH: { type: "RH" } });
  });

  it("demandeur RH sans autre RH ni DG : refusé d'emblée (aucun décideur)", () => {
    const p = resoudreParcoursAbsence(ctx({ demandeurId: RH1, comptesRH: [RH1], comptesDG: [] }));
    expect(p).toEqual({ ok: false, erreur: MESSAGE_AUCUN_DECIDEUR });
  });

  it("demandeur à la fois RH et DG, seul à l'être : aucun décideur", () => {
    const p = resoudreParcoursAbsence(ctx({ demandeurId: DG, comptesRH: [DG], comptesDG: [DG] }));
    expect(p.ok).toBe(false);
  });
});

describe("décideur recalculé", () => {
  it("rien à décider hors statuts en attente", () => {
    for (const s of ["VALIDEE", "REJETEE", "ANNULEE", "MODIFICATION_DEMANDEE"] as const) {
      expect(decideurPourStatutAbsence(s, ctx())).toBeNull();
    }
  });

  it("en attente du responsable : le responsable actuel", () => {
    expect(decideurPourStatutAbsence("EN_ATTENTE_RESPONSABLE", ctx())).toEqual({ type: "RESPONSABLE", responsableId: RESP });
  });

  it("changement de responsable : le nouveau décide immédiatement", () => {
    const c = ctx({ service: { name: "Commercial", responsableId: "u-nouveau", responsableActif: true } });
    expect(decideurPourStatutAbsence("EN_ATTENTE_RESPONSABLE", c)).toEqual({ type: "RESPONSABLE", responsableId: "u-nouveau" });
  });

  it("responsable devenu inactif : repli sur la RH", () => {
    const c = ctx({ service: { name: "Commercial", responsableId: RESP, responsableActif: false } });
    expect(decideurPourStatutAbsence("EN_ATTENTE_RESPONSABLE", c)).toEqual({ type: "RH", repli: true });
  });

  it("repli sans autre RH : le DG", () => {
    const c = ctx({ service: null, comptesRH: [DEMANDEUR] });
    expect(decideurPourStatutAbsence("EN_ATTENTE_RESPONSABLE", c)).toEqual({ type: "DG", repli: true });
  });

  it("en attente de la RH : la RH sans repli", () => {
    expect(decideurPourStatutAbsence("EN_ATTENTE_RH", ctx())).toEqual({ type: "RH", repli: false });
  });
});

describe("refus de décider", () => {
  it("personne ne décide sa propre demande, même avec la permission RH", () => {
    const c = ctx({ comptesRH: [DEMANDEUR, RH1] });
    const d = decideurPourStatutAbsence("EN_ATTENTE_RH", c);
    expect(refusDecideurAbsence(d, rh(DEMANDEUR), DEMANDEUR, "CONGE")).toBe(MESSAGE_PROPRE_DEMANDE_ABSENCE);
  });

  it("à l'étape responsable, seul le responsable désigné décide (la RH non)", () => {
    const d = decideurPourStatutAbsence("EN_ATTENTE_RESPONSABLE", ctx());
    expect(refusDecideurAbsence(d, acteur(RESP), DEMANDEUR, "CONGE")).toBeNull();
    expect(refusDecideurAbsence(d, rh(), DEMANDEUR, "CONGE")).toBe(MESSAGE_RESERVE_RESPONSABLE_ABSENCE);
    expect(refusDecideurAbsence(d, acteur("u-autre"), DEMANDEUR, "CONGE")).toBe(MESSAGE_RESERVE_RESPONSABLE_ABSENCE);
  });

  it("à l'étape RH, la permission de décision des congés est exigée", () => {
    const d = decideurPourStatutAbsence("EN_ATTENTE_RH", ctx());
    expect(refusDecideurAbsence(d, rh(), DEMANDEUR, "CONGE")).toBeNull();
    expect(refusDecideurAbsence(d, acteur(RH1), DEMANDEUR, "CONGE")).toBe(MESSAGE_RESERVE_RH_ABSENCE);
  });

  it("le DG ne décide pas au niveau RH, et le responsable non plus", () => {
    const d = decideurPourStatutAbsence("EN_ATTENTE_RH", ctx());
    expect(refusDecideurAbsence(d, acteur(DG, "treso.decider_dg"), DEMANDEUR, "CONGE")).toBe(MESSAGE_RESERVE_RH_ABSENCE);
    expect(refusDecideurAbsence(d, acteur(RESP), DEMANDEUR, "CONGE")).toBe(MESSAGE_RESERVE_RH_ABSENCE);
  });

  it("niveau DG : seul un porteur de treso.decider_dg décide", () => {
    const c = ctx({ demandeurId: RH1, comptesRH: [RH1] });
    const d = decideurPourStatutAbsence("EN_ATTENTE_RH", c);
    expect(refusDecideurAbsence(d, acteur(DG, "treso.decider_dg"), RH1, "CONGE")).toBeNull();
    expect(refusDecideurAbsence(d, rh(RH2), RH1, "CONGE")).toBe(MESSAGE_RESERVE_DG_ABSENCE);
  });

  it("pas de décideur : refus explicite", () => {
    expect(refusDecideurAbsence(null, rh(), DEMANDEUR, "CONGE")).toMatch(/n'attend plus/);
  });
});

describe("transitions", () => {
  it("le responsable approuve : la demande passe à la RH, sans effet", () => {
    const c = ctx();
    const r = transitionAbsence({ ...param("EN_ATTENTE_RESPONSABLE", c), action: { type: "APPROUVER" }, acteur: acteur(RESP) });
    expect(r).toEqual({ ok: true, statut: "EN_ATTENTE_RH", effet: "AUCUN", etape: "RESPONSABLE" });
  });

  it("la RH approuve un congé : VALIDEE + effet ACCORDER", () => {
    const c = ctx();
    const r = transitionAbsence({ ...param("EN_ATTENTE_RH", c), action: { type: "APPROUVER" }, acteur: rh() });
    expect(r).toEqual({ ok: true, statut: "VALIDEE", effet: "ACCORDER", etape: "RH" });
  });

  it("la RH ne valide pas depuis EN_ATTENTE_RESPONSABLE tant que le responsable peut décider", () => {
    const c = ctx();
    const r = transitionAbsence({ ...param("EN_ATTENTE_RESPONSABLE", c), action: { type: "APPROUVER" }, acteur: rh() });
    expect(r).toEqual({ ok: false, erreur: MESSAGE_RESERVE_RESPONSABLE_ABSENCE });
  });

  it("repli : la RH termine directement quand le responsable ne peut plus décider", () => {
    const c = ctx({ service: { name: "Commercial", responsableId: RESP, responsableActif: false } });
    const r = transitionAbsence({ ...param("EN_ATTENTE_RESPONSABLE", c), action: { type: "APPROUVER" }, acteur: rh() });
    expect(r).toEqual({ ok: true, statut: "VALIDEE", effet: "ACCORDER", etape: "RH", viaRepli: true });
  });

  it("repli : un rejet par la RH est marqué viaRepli", () => {
    const c = ctx({ service: null });
    const r = transitionAbsence({
      ...param("EN_ATTENTE_RESPONSABLE", c),
      action: { type: "REJETER", motif: "  pas   possible " },
      acteur: rh(),
    });
    expect(r).toMatchObject({ ok: true, statut: "REJETEE", motif: "pas possible", viaRepli: true });
  });

  it("rejet et demande de modification exigent un motif d'au moins 3 caractères", () => {
    const c = ctx();
    const base = { ...param("EN_ATTENTE_RH", c), acteur: rh() };
    expect(transitionAbsence({ ...base, action: { type: "REJETER", motif: "ab" } })).toMatchObject({ ok: false });
    expect(transitionAbsence({ ...base, action: { type: "DEMANDER_MODIFICATION", motif: "  " } })).toMatchObject({ ok: false });
    expect(transitionAbsence({ ...base, action: { type: "DEMANDER_MODIFICATION", motif: "Précisez les dates" } })).toMatchObject({
      ok: true,
      statut: "MODIFICATION_DEMANDEE",
    });
  });

  it("motif trop long refusé", () => {
    const c = ctx();
    const r = transitionAbsence({ ...param("EN_ATTENTE_RH", c), acteur: rh(), action: { type: "REJETER", motif: "x".repeat(501) } });
    expect(r).toMatchObject({ ok: false });
  });

  it("aucune décision depuis un statut final, rejeté, annulé ou à modifier", () => {
    const c = ctx();
    for (const s of ["VALIDEE", "REJETEE", "ANNULEE", "MODIFICATION_DEMANDEE"] as const) {
      const r = transitionAbsence({ ...param(s, c), action: { type: "APPROUVER" }, acteur: rh() });
      expect(r.ok).toBe(false);
    }
  });

  it("le demandeur ne décide jamais, même porteur de la permission RH", () => {
    const c = ctx({ comptesRH: [DEMANDEUR, RH1] });
    const r = transitionAbsence({ ...param("EN_ATTENTE_RH", c), action: { type: "APPROUVER" }, acteur: rh(DEMANDEUR) });
    expect(r).toEqual({ ok: false, erreur: MESSAGE_PROPRE_DEMANDE_ABSENCE });
  });

  it("resoumission : le demandeur seul, depuis MODIFICATION_DEMANDEE", () => {
    const c = ctx();
    const base = { ...param("MODIFICATION_DEMANDEE", c), action: { type: "RESOUMETTRE", premierStatut: "EN_ATTENTE_RESPONSABLE" } as const };
    expect(transitionAbsence({ ...base, acteur: acteur(DEMANDEUR) })).toEqual({ ok: true, statut: "EN_ATTENTE_RESPONSABLE", effet: "AUCUN" });
    expect(transitionAbsence({ ...base, acteur: rh() })).toMatchObject({ ok: false });
    expect(transitionAbsence({ ...param("EN_ATTENTE_RH", c), action: base.action, acteur: acteur(DEMANDEUR) })).toMatchObject({ ok: false });
  });
});

describe("annulation", () => {
  const c = ctx();
  const annuler = (statut: StatutCircuitAbsence, a: ActeurAbsence, extra: { adebute?: boolean; peutAnnulerApresDebut?: boolean } = {}) =>
    transitionAbsence({ ...param(statut, c), action: { type: "ANNULER", motif: "Plus nécessaire" }, acteur: a, ...extra });

  it("le demandeur annule une demande en cours : aucun effet comptable", () => {
    expect(annuler("EN_ATTENTE_RESPONSABLE", acteur(DEMANDEUR))).toEqual({ ok: true, statut: "ANNULEE", motif: "Plus nécessaire", effet: "AUCUN" });
    expect(annuler("EN_ATTENTE_RH", acteur(DEMANDEUR))).toMatchObject({ ok: true, effet: "AUCUN" });
    expect(annuler("MODIFICATION_DEMANDEE", acteur(DEMANDEUR))).toMatchObject({ ok: true, effet: "AUCUN" });
  });

  it("le demandeur annule un congé validé avant son début : effet DEFAIRE_ACCORD", () => {
    expect(annuler("VALIDEE", acteur(DEMANDEUR), { adebute: false })).toMatchObject({ ok: true, effet: "DEFAIRE_ACCORD" });
  });

  it("le demandeur ne peut plus annuler une fois l'absence commencée", () => {
    const r = annuler("VALIDEE", acteur(DEMANDEUR), { adebute: true });
    expect(r).toMatchObject({ ok: false });
  });

  it("la RH annule après le début", () => {
    expect(annuler("VALIDEE", rh(), { adebute: true, peutAnnulerApresDebut: true })).toMatchObject({ ok: true, effet: "DEFAIRE_ACCORD" });
  });

  it("un tiers sans autorisation ne peut pas annuler", () => {
    expect(annuler("EN_ATTENTE_RH", acteur("u-autre"))).toMatchObject({ ok: false });
  });

  it("une demande rejetée ou déjà annulée ne s'annule pas", () => {
    expect(annuler("REJETEE", acteur(DEMANDEUR))).toMatchObject({ ok: false });
    expect(annuler("ANNULEE", acteur(DEMANDEUR))).toMatchObject({ ok: false });
  });

  it("motif d'annulation obligatoire", () => {
    const r = transitionAbsence({ ...param("EN_ATTENTE_RH", c), action: { type: "ANNULER", motif: "" }, acteur: acteur(DEMANDEUR) });
    expect(r).toMatchObject({ ok: false });
  });
});

describe("actions possibles (boutons grisés avec la phrase du serveur)", () => {
  it("le responsable à son étape : peut approuver, rejeter, demander une modification, pas resoumettre", () => {
    const c = ctx();
    const a = actionsPossiblesAbsence({ ...param("EN_ATTENTE_RESPONSABLE", c), acteur: acteur(RESP) });
    expect(a.approuver).toBeNull();
    expect(a.rejeter).toBeNull();
    expect(a.demanderModification).toBeNull();
    expect(a.resoumettre).not.toBeNull();
    expect(a.annuler).not.toBeNull();
  });

  it("le demandeur : annuler seulement", () => {
    const c = ctx();
    const a = actionsPossiblesAbsence({ ...param("EN_ATTENTE_RH", c), acteur: acteur(DEMANDEUR) });
    expect(a.approuver).toBe(MESSAGE_PROPRE_DEMANDE_ABSENCE);
    expect(a.annuler).toBeNull();
  });
});

describe("destinataires ciblés", () => {
  it("étape responsable : le responsable seul", () => {
    expect(destinatairesEtapeAbsence("EN_ATTENTE_RESPONSABLE", ctx())).toEqual([RESP]);
  });

  it("étape RH : tous les comptes RH sauf le demandeur", () => {
    const c = ctx({ comptesRH: [RH1, RH2, DEMANDEUR] });
    expect(destinatairesEtapeAbsence("EN_ATTENTE_RH", c).sort()).toEqual([RH1, RH2]);
  });

  it("repli : la RH est prévenue à la place du responsable empêché", () => {
    const c = ctx({ service: { name: "X", responsableId: RESP, responsableActif: false } });
    expect(destinatairesEtapeAbsence("EN_ATTENTE_RESPONSABLE", c)).toEqual([RH1]);
  });

  it("sans autre RH : le DG, jamais le demandeur", () => {
    const c = ctx({ demandeurId: RH1, comptesRH: [RH1], comptesDG: [DG, RH1] });
    expect(destinatairesEtapeAbsence("EN_ATTENTE_RH", c)).toEqual([DG]);
  });

  it("aucun destinataire pour un statut sans décision", () => {
    expect(destinatairesEtapeAbsence("VALIDEE", ctx())).toEqual([]);
  });
});

describe("frise", () => {
  const etats = (statut: StatutCircuitAbsence, requise = true) =>
    friseAbsence({ nature: "CONGE", statut, etapeResponsableRequise: requise }).map((e) => e.etat);

  it("en attente du responsable", () => {
    expect(etats("EN_ATTENTE_RESPONSABLE")).toEqual(["faite", "en_cours", "a_venir", "a_venir"]);
  });

  it("en attente de la RH, étape responsable faite", () => {
    expect(etats("EN_ATTENTE_RH")).toEqual(["faite", "faite", "en_cours", "a_venir"]);
  });

  it("étape responsable non requise", () => {
    expect(etats("EN_ATTENTE_RH", false)).toEqual(["faite", "non_requise", "en_cours", "a_venir"]);
  });

  it("accordée", () => {
    expect(etats("VALIDEE")).toEqual(["faite", "faite", "faite", "faite"]);
  });

  it("rejetée : la décision est interrompue", () => {
    expect(etats("REJETEE").at(-1)).toBe("interrompue");
  });
});

describe("divers", () => {
  it("états finals accordés", () => {
    expect(estStatutFinalAccorde("CONGE", "VALIDEE")).toBe(true);
    expect(estStatutFinalAccorde("CONGE", "REJETEE")).toBe(false);
  });

  it("nettoyage de motif", () => {
    expect(nettoyerMotifAbsence("  a \n b  ")).toBe("a b");
  });

  it("actions d'historique distinctes", () => {
    expect(new Set(Object.values(ACTION_HISTORIQUE_ABSENCE)).size).toBe(Object.keys(ACTION_HISTORIQUE_ABSENCE).length);
  });
});

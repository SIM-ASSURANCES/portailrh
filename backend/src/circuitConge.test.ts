import { describe, expect, it } from "vitest";
import {
  ACTION_HISTORIQUE_CONGE,
  LIBELLE_NATURE_CONGE,
  LIBELLE_STATUT_CONGE,
  MESSAGE_ANNULATION_NON_AUTORISEE,
  MESSAGE_AUCUN_DECIDEUR,
  MESSAGE_CONGE_COMMENCE,
  MESSAGE_PROPRE_DEMANDE_CONGE,
  MESSAGE_RESERVE_DG_CONGE,
  MESSAGE_RESERVE_RESPONSABLE_CONGE,
  MESSAGE_RESERVE_RH_CONGE,
  actionsPossiblesConge,
  controlerObservationRH,
  decideurPourStatutConge,
  destinatairesEtapeConge,
  friseConge,
  nettoyerMotifConge,
  peutConsulterConge,
  refusDecideurConge,
  resoudreParcoursConge,
  transitionConge,
  type ActeurConge,
  type ContexteCircuitConge,
  type StatutCircuitConge,
} from "./circuitConge";

const DEMANDEUR = "u-demandeur";
const RESP = "u-resp";
const RH1 = "u-rh1";
const RH2 = "u-rh2";
const DG = "u-dg";

function ctx(over: Partial<ContexteCircuitConge> = {}): ContexteCircuitConge {
  return {
    demandeurId: DEMANDEUR,
    service: { name: "Commercial", responsableId: RESP, responsableActif: true },
    comptesRH: [RH1],
    comptesDG: [DG],
    ...over,
  };
}

const acteur = (id: string, ...rolePermissions: string[]): ActeurConge => ({ id, rolePermissions });
const rh = (id = RH1) => acteur(id, "conges.valider_rh");

function param(statut: StatutCircuitConge, c: ContexteCircuitConge) {
  return { statut, demandeurId: c.demandeurId, decideur: decideurPourStatutConge(statut, c) };
}

describe("résolution du parcours", () => {
  it("cas courant : le responsable d'abord, puis la RH", () => {
    const p = resoudreParcoursConge(ctx());
    expect(p).toMatchObject({ ok: true, premierStatut: "EN_ATTENTE_RESPONSABLE", etapeRH: { type: "RH" } });
  });

  it("demandeur responsable de son service : étape responsable non requise, directement la RH", () => {
    const p = resoudreParcoursConge(
      ctx({ service: { name: "Commercial", responsableId: DEMANDEUR, responsableActif: true } })
    );
    expect(p).toMatchObject({
      ok: true,
      premierStatut: "EN_ATTENTE_RH",
      etapeResponsable: { requise: false, raison: "EST_RESPONSABLE" },
    });
  });

  it.each([
    ["sans service", null, "SANS_SERVICE"],
    ["sans responsable", { name: "X", responsableId: null, responsableActif: false }, "SANS_RESPONSABLE"],
    ["responsable désactivé", { name: "X", responsableId: RESP, responsableActif: false }, "RESPONSABLE_INACTIF"],
  ] as const)("%s : l'étape responsable n'est pas requise", (_nom, service, raison) => {
    const p = resoudreParcoursConge(ctx({ service }));
    expect(p).toMatchObject({ ok: true, premierStatut: "EN_ATTENTE_RH" });
    expect(p.ok && p.etapeResponsable).toEqual({ requise: false, raison });
  });

  it("demandeur RH sans autre compte RH : le DG décide à l'étape RH", () => {
    const p = resoudreParcoursConge(ctx({ demandeurId: RH1, comptesRH: [RH1] }));
    expect(p).toMatchObject({ ok: true, etapeRH: { type: "DG" } });
  });

  it("demandeur RH avec un autre compte RH : la RH décide", () => {
    const p = resoudreParcoursConge(ctx({ demandeurId: RH1, comptesRH: [RH1, RH2] }));
    expect(p).toMatchObject({ ok: true, etapeRH: { type: "RH" } });
  });

  it("demandeur RH sans autre RH ni DG : refusé d'emblée (aucun décideur)", () => {
    const p = resoudreParcoursConge(ctx({ demandeurId: RH1, comptesRH: [RH1], comptesDG: [] }));
    expect(p).toEqual({ ok: false, erreur: MESSAGE_AUCUN_DECIDEUR });
  });

  it("demandeur à la fois RH et DG, seul à l'être : aucun décideur", () => {
    const p = resoudreParcoursConge(ctx({ demandeurId: DG, comptesRH: [DG], comptesDG: [DG] }));
    expect(p.ok).toBe(false);
  });
});

describe("décideur recalculé", () => {
  it("rien à décider hors statuts en attente", () => {
    for (const s of ["VALIDEE", "REJETEE", "ANNULEE", "MODIFICATION_DEMANDEE"] as const) {
      expect(decideurPourStatutConge(s, ctx())).toBeNull();
    }
  });

  it("en attente du responsable : le responsable actuel", () => {
    expect(decideurPourStatutConge("EN_ATTENTE_RESPONSABLE", ctx())).toEqual({ type: "RESPONSABLE", responsableId: RESP });
  });

  it("changement de responsable : le nouveau décide immédiatement", () => {
    const c = ctx({ service: { name: "Commercial", responsableId: "u-nouveau", responsableActif: true } });
    expect(decideurPourStatutConge("EN_ATTENTE_RESPONSABLE", c)).toEqual({ type: "RESPONSABLE", responsableId: "u-nouveau" });
  });

  it("responsable devenu inactif : repli sur la RH", () => {
    const c = ctx({ service: { name: "Commercial", responsableId: RESP, responsableActif: false } });
    expect(decideurPourStatutConge("EN_ATTENTE_RESPONSABLE", c)).toEqual({ type: "RH", repli: true });
  });

  it("repli sans autre RH : le DG", () => {
    const c = ctx({ service: null, comptesRH: [DEMANDEUR] });
    expect(decideurPourStatutConge("EN_ATTENTE_RESPONSABLE", c)).toEqual({ type: "DG", repli: true });
  });

  it("en attente de la RH : la RH sans repli", () => {
    expect(decideurPourStatutConge("EN_ATTENTE_RH", ctx())).toEqual({ type: "RH", repli: false });
  });
});

describe("refus de décider", () => {
  it("personne ne décide sa propre demande, même avec la permission RH", () => {
    const c = ctx({ comptesRH: [DEMANDEUR, RH1] });
    const d = decideurPourStatutConge("EN_ATTENTE_RH", c);
    expect(refusDecideurConge(d, rh(DEMANDEUR), DEMANDEUR)).toBe(MESSAGE_PROPRE_DEMANDE_CONGE);
  });

  it("à l'étape responsable, seul le responsable désigné décide (la RH non)", () => {
    const d = decideurPourStatutConge("EN_ATTENTE_RESPONSABLE", ctx());
    expect(refusDecideurConge(d, acteur(RESP), DEMANDEUR)).toBeNull();
    expect(refusDecideurConge(d, rh(), DEMANDEUR)).toBe(MESSAGE_RESERVE_RESPONSABLE_CONGE);
    expect(refusDecideurConge(d, acteur("u-autre"), DEMANDEUR)).toBe(MESSAGE_RESERVE_RESPONSABLE_CONGE);
  });

  it("à l'étape RH, la permission de décision des congés est exigée", () => {
    const d = decideurPourStatutConge("EN_ATTENTE_RH", ctx());
    expect(refusDecideurConge(d, rh(), DEMANDEUR)).toBeNull();
    expect(refusDecideurConge(d, acteur(RH1), DEMANDEUR)).toBe(MESSAGE_RESERVE_RH_CONGE);
  });

  it("le DG ne décide pas au niveau RH, et le responsable non plus", () => {
    const d = decideurPourStatutConge("EN_ATTENTE_RH", ctx());
    expect(refusDecideurConge(d, acteur(DG, "treso.decider_dg"), DEMANDEUR)).toBe(MESSAGE_RESERVE_RH_CONGE);
    expect(refusDecideurConge(d, acteur(RESP), DEMANDEUR)).toBe(MESSAGE_RESERVE_RH_CONGE);
  });

  it("niveau DG : seul un porteur de treso.decider_dg décide", () => {
    const c = ctx({ demandeurId: RH1, comptesRH: [RH1] });
    const d = decideurPourStatutConge("EN_ATTENTE_RH", c);
    expect(refusDecideurConge(d, acteur(DG, "treso.decider_dg"), RH1)).toBeNull();
    expect(refusDecideurConge(d, rh(RH2), RH1)).toBe(MESSAGE_RESERVE_DG_CONGE);
  });

  it("pas de décideur : refus explicite", () => {
    expect(refusDecideurConge(null, rh(), DEMANDEUR)).toMatch(/n'attend plus/);
  });
});

describe("transitions", () => {
  it("le responsable approuve : la demande passe à la RH, sans effet", () => {
    const c = ctx();
    const r = transitionConge({ ...param("EN_ATTENTE_RESPONSABLE", c), action: { type: "APPROUVER" }, acteur: acteur(RESP) });
    expect(r).toEqual({ ok: true, statut: "EN_ATTENTE_RH", effet: "AUCUN", etape: "RESPONSABLE" });
  });

  it("la RH approuve un congé : VALIDEE + effet VALIDER", () => {
    const c = ctx();
    const r = transitionConge({ ...param("EN_ATTENTE_RH", c), action: { type: "APPROUVER" }, acteur: rh() });
    expect(r).toEqual({ ok: true, statut: "VALIDEE", effet: "VALIDER", etape: "RH" });
  });

  it("la RH ne valide pas depuis EN_ATTENTE_RESPONSABLE tant que le responsable peut décider", () => {
    const c = ctx();
    const r = transitionConge({ ...param("EN_ATTENTE_RESPONSABLE", c), action: { type: "APPROUVER" }, acteur: rh() });
    expect(r).toEqual({ ok: false, erreur: MESSAGE_RESERVE_RESPONSABLE_CONGE });
  });

  it("repli : la RH termine directement quand le responsable ne peut plus décider", () => {
    const c = ctx({ service: { name: "Commercial", responsableId: RESP, responsableActif: false } });
    const r = transitionConge({ ...param("EN_ATTENTE_RESPONSABLE", c), action: { type: "APPROUVER" }, acteur: rh() });
    expect(r).toEqual({ ok: true, statut: "VALIDEE", effet: "VALIDER", etape: "RH", viaRepli: true });
  });

  it("repli : un rejet par la RH est marqué viaRepli", () => {
    const c = ctx({ service: null });
    const r = transitionConge({
      ...param("EN_ATTENTE_RESPONSABLE", c),
      action: { type: "REJETER", motif: "  pas   possible " },
      acteur: rh(),
    });
    expect(r).toMatchObject({ ok: true, statut: "REJETEE", motif: "pas possible", viaRepli: true });
  });

  it("rejet et demande de modification exigent un motif d'au moins 3 caractères", () => {
    const c = ctx();
    const base = { ...param("EN_ATTENTE_RH", c), acteur: rh() };
    expect(transitionConge({ ...base, action: { type: "REJETER", motif: "ab" } })).toMatchObject({ ok: false });
    expect(transitionConge({ ...base, action: { type: "DEMANDER_MODIFICATION", motif: "  " } })).toMatchObject({ ok: false });
    expect(transitionConge({ ...base, action: { type: "DEMANDER_MODIFICATION", motif: "Précisez les dates" } })).toMatchObject({
      ok: true,
      statut: "MODIFICATION_DEMANDEE",
    });
  });

  it("motif trop long refusé", () => {
    const c = ctx();
    const r = transitionConge({ ...param("EN_ATTENTE_RH", c), acteur: rh(), action: { type: "REJETER", motif: "x".repeat(501) } });
    expect(r).toMatchObject({ ok: false });
  });

  it("aucune décision depuis un statut final, rejeté, annulé ou à modifier", () => {
    const c = ctx();
    for (const s of ["VALIDEE", "REJETEE", "ANNULEE", "MODIFICATION_DEMANDEE"] as const) {
      const r = transitionConge({ ...param(s, c), action: { type: "APPROUVER" }, acteur: rh() });
      expect(r.ok).toBe(false);
    }
  });

  it("le demandeur ne décide jamais, même porteur de la permission RH", () => {
    const c = ctx({ comptesRH: [DEMANDEUR, RH1] });
    const r = transitionConge({ ...param("EN_ATTENTE_RH", c), action: { type: "APPROUVER" }, acteur: rh(DEMANDEUR) });
    expect(r).toEqual({ ok: false, erreur: MESSAGE_PROPRE_DEMANDE_CONGE });
  });

  it("resoumission : le demandeur seul, depuis MODIFICATION_DEMANDEE", () => {
    const c = ctx();
    const base = { ...param("MODIFICATION_DEMANDEE", c), action: { type: "RESOUMETTRE", premierStatut: "EN_ATTENTE_RESPONSABLE" } as const };
    expect(transitionConge({ ...base, acteur: acteur(DEMANDEUR) })).toEqual({ ok: true, statut: "EN_ATTENTE_RESPONSABLE", effet: "AUCUN" });
    expect(transitionConge({ ...base, acteur: rh() })).toMatchObject({ ok: false });
    expect(transitionConge({ ...param("EN_ATTENTE_RH", c), action: base.action, acteur: acteur(DEMANDEUR) })).toMatchObject({ ok: false });
  });
});

describe("annulation (R9)", () => {
  const c = ctx();
  const annuler = (statut: StatutCircuitConge, a: ActeurConge, extra: { adebute?: boolean; peutAnnulerApresDebut?: boolean } = {}) =>
    transitionConge({ ...param(statut, c), action: { type: "ANNULER", motif: "Plus nécessaire" }, acteur: a, ...extra });
  const OK = { ok: true, statut: "ANNULEE", effet: "SUPPRIMER_PLAGES" };

  it("le demandeur annule une demande en cours, à modifier ou validée tant que le congé n'a pas commencé", () => {
    for (const s of ["EN_ATTENTE_RESPONSABLE", "EN_ATTENTE_RH", "MODIFICATION_DEMANDEE", "VALIDEE"] as const) {
      expect(annuler(s, acteur(DEMANDEUR), { adebute: false })).toMatchObject(OK);
    }
  });

  it("la veille du début : acceptée ; le jour du début : refusée au demandeur", () => {
    expect(annuler("VALIDEE", acteur(DEMANDEUR), { adebute: false })).toMatchObject(OK);
    expect(annuler("VALIDEE", acteur(DEMANDEUR), { adebute: true })).toEqual({ ok: false, erreur: MESSAGE_CONGE_COMMENCE });
  });

  it("une demande en attente dont le début est atteint ne s'annule plus par le demandeur", () => {
    expect(annuler("EN_ATTENTE_RH", acteur(DEMANDEUR), { adebute: true })).toEqual({ ok: false, erreur: MESSAGE_CONGE_COMMENCE });
  });

  it("un compte qui porte conges.annuler annule à tout moment, après le début aussi", () => {
    expect(annuler("VALIDEE", rh(), { adebute: true, peutAnnulerApresDebut: true })).toMatchObject(OK);
    expect(annuler("EN_ATTENTE_RH", rh(), { adebute: false, peutAnnulerApresDebut: true })).toMatchObject(OK);
  });

  it("un tiers sans autorisation ne peut pas annuler", () => {
    expect(annuler("EN_ATTENTE_RH", acteur("u-autre"))).toEqual({ ok: false, erreur: MESSAGE_ANNULATION_NON_AUTORISEE });
  });

  it("une demande rejetée ou déjà annulée ne s'annule pas", () => {
    expect(annuler("REJETEE", acteur(DEMANDEUR))).toMatchObject({ ok: false });
    expect(annuler("ANNULEE", acteur(DEMANDEUR))).toMatchObject({ ok: false });
  });

  it("motif d'annulation obligatoire", () => {
    const r = transitionConge({ ...param("EN_ATTENTE_RH", c), action: { type: "ANNULER", motif: "" }, acteur: acteur(DEMANDEUR) });
    expect(r).toMatchObject({ ok: false });
  });

  it("le bouton « Annuler » est grisé avec la même phrase que le serveur", () => {
    const base = { ...param("VALIDEE", c), acteur: acteur(DEMANDEUR) };
    expect(actionsPossiblesConge({ ...base, adebute: true }).annuler).toBe(MESSAGE_CONGE_COMMENCE);
    expect(actionsPossiblesConge({ ...base, adebute: false }).annuler).toBeNull();
  });
});

describe("effets sur les plages (R10)", () => {
  it("la validation par la RH valide les plages ; le refus et l'annulation les suppriment ; le reste ne touche à rien", () => {
    const c = ctx();
    const rhCtx = param("EN_ATTENTE_RH", c);
    expect(transitionConge({ ...rhCtx, action: { type: "APPROUVER" }, acteur: rh() })).toMatchObject({ effet: "VALIDER" });
    expect(transitionConge({ ...rhCtx, action: { type: "REJETER", motif: "Période chargée" }, acteur: rh() })).toMatchObject({ effet: "SUPPRIMER_PLAGES" });
    expect(transitionConge({ ...rhCtx, action: { type: "DEMANDER_MODIFICATION", motif: "Précisez" }, acteur: rh() })).toMatchObject({ effet: "AUCUN" });
    expect(transitionConge({ ...param("EN_ATTENTE_RESPONSABLE", c), action: { type: "APPROUVER" }, acteur: acteur(RESP) })).toMatchObject({ effet: "AUCUN" });
  });
});

describe("observation de la RH", () => {
  it("facultative, nettoyée, réservée à l'étape RH, 500 caractères au plus", () => {
    expect(controlerObservationRH(undefined, "RH")).toEqual({ ok: true, texte: null });
    expect(controlerObservationRH("   ", "RH")).toEqual({ ok: true, texte: null });
    expect(controlerObservationRH("  Bon   repos ", "RH")).toEqual({ ok: true, texte: "Bon repos" });
    expect(controlerObservationRH("Bon repos", "RESPONSABLE")).toMatchObject({ ok: false });
    expect(controlerObservationRH("x".repeat(501), "RH")).toMatchObject({ ok: false });
    expect(controlerObservationRH("x".repeat(500), "RH")).toMatchObject({ ok: true });
  });
});

describe("actions possibles (boutons grisés avec la phrase du serveur)", () => {
  it("le responsable à son étape : peut approuver, rejeter, demander une modification, pas resoumettre", () => {
    const c = ctx();
    const a = actionsPossiblesConge({ ...param("EN_ATTENTE_RESPONSABLE", c), acteur: acteur(RESP) });
    expect(a.approuver).toBeNull();
    expect(a.rejeter).toBeNull();
    expect(a.demanderModification).toBeNull();
    expect(a.resoumettre).not.toBeNull();
    expect(a.annuler).not.toBeNull();
  });

  it("le demandeur : annuler seulement", () => {
    const c = ctx();
    const a = actionsPossiblesConge({ ...param("EN_ATTENTE_RH", c), acteur: acteur(DEMANDEUR) });
    expect(a.approuver).toBe(MESSAGE_PROPRE_DEMANDE_CONGE);
    expect(a.annuler).toBeNull();
  });
});

describe("destinataires ciblés", () => {
  it("étape responsable : le responsable seul", () => {
    expect(destinatairesEtapeConge("EN_ATTENTE_RESPONSABLE", ctx())).toEqual([RESP]);
  });

  it("étape RH : tous les comptes RH sauf le demandeur", () => {
    const c = ctx({ comptesRH: [RH1, RH2, DEMANDEUR] });
    expect(destinatairesEtapeConge("EN_ATTENTE_RH", c).sort()).toEqual([RH1, RH2]);
  });

  it("repli : la RH est prévenue à la place du responsable empêché", () => {
    const c = ctx({ service: { name: "X", responsableId: RESP, responsableActif: false } });
    expect(destinatairesEtapeConge("EN_ATTENTE_RESPONSABLE", c)).toEqual([RH1]);
  });

  it("sans autre RH : le DG, jamais le demandeur", () => {
    const c = ctx({ demandeurId: RH1, comptesRH: [RH1], comptesDG: [DG, RH1] });
    expect(destinatairesEtapeConge("EN_ATTENTE_RH", c)).toEqual([DG]);
  });

  it("aucun destinataire pour un statut sans décision", () => {
    expect(destinatairesEtapeConge("VALIDEE", ctx())).toEqual([]);
  });
});

describe("frise", () => {
  const etats = (statut: StatutCircuitConge, requise = true) =>
    friseConge({ statut, etapeResponsableRequise: requise }).map((e) => e.etat);

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
  it("nettoyage de motif", () => {
    expect(nettoyerMotifConge("  a \n b  ")).toBe("a b");
  });

  it("actions d'historique distinctes", () => {
    expect(new Set(Object.values(ACTION_HISTORIQUE_CONGE)).size).toBe(Object.keys(ACTION_HISTORIQUE_CONGE).length);
  });

  it("libellés de statut et de nature", () => {
    expect(LIBELLE_NATURE_CONGE).toEqual({ CONGE: "Congé", PERMISSION_EXCEPTIONNELLE: "Permission exceptionnelle" });
    expect(LIBELLE_STATUT_CONGE.MODIFICATION_DEMANDEE).toBe("Modification demandée");
  });

  it("qui peut consulter : le demandeur, le responsable actuel, la RH, ceux qui consultent tout — pas un autre collaborateur", () => {
    const base = { demandeurId: DEMANDEUR, responsableDuServiceId: RESP, permissions: [] as string[] };
    expect(peutConsulterConge({ ...base, acteurId: DEMANDEUR })).toBe(true);
    expect(peutConsulterConge({ ...base, acteurId: RESP })).toBe(true);
    expect(peutConsulterConge({ ...base, acteurId: RH1, permissions: ["conges.valider_rh"] })).toBe(true);
    expect(peutConsulterConge({ ...base, acteurId: DG, permissions: ["conges.consulter_tous"] })).toBe(true);
    expect(peutConsulterConge({ ...base, acteurId: "u-autre" })).toBe(false);
  });

  it("le DG ne décide jamais hors repli (O1) : il n'est pas décideur de l'étape RH quand un autre compte RH existe", () => {
    const d = decideurPourStatutConge("EN_ATTENTE_RH", ctx());
    expect(refusDecideurConge(d, acteur(DG, "treso.decider_dg"), DEMANDEUR)).toBe(MESSAGE_RESERVE_RH_CONGE);
  });
});

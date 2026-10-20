import { describe, expect, it } from "vitest";

import { determinerParcours, raisonIndisponible, transition, type ActeurCircuit, type DemandeCircuit, type LigneCircuit } from "./circuitDemande";
import {
  detailReorientation,
  libelleDelaiEcoule,
  MOTIF_REORIENTATION_MIN,
  PERMISSION_REORIENTER_DEMANDE,
  raisonExclusionCandidat,
  refusCibleReorientation,
  refusMotifReorientation,
  responsableServiceEffectif,
  responsablesEligibles,
  type CandidatResponsable,
  type ContexteReorientation,
} from "./circuitReorientation";
import { notificationsReorientation, type ContexteNotificationCircuit } from "./circuitNotifications";
import type { EtapeCircuit } from "./generated/prisma/enums";

// Lot K, partie 1 — réorientation de l'étape Service.

const DEMANDEUR = "u-demandeur";
const acteur = (userId: string, permissions: string[] = [], resp = false): ActeurCircuit => ({ userId, permissions, estResponsableServiceDuDemandeur: resp });
const FINANCE = acteur("u-fin", ["treso.decider_finance", PERMISSION_REORIENTER_DEMANDE]);
const FINANCE_SANS = acteur("u-fin2", ["treso.decider_finance"]);
const AUTRE = acteur("u-autre");
const MOTIF = "Le responsable est en mission toute la semaine";

const ligne = (id: string): LigneCircuit => ({ id, libelle: `Ligne ${id}`, categorisee: true, statut: "EN_ATTENTE", soumiseAuDG: false, decisionDG: null, decisionDGParId: null });
function demande(etape: EtapeCircuit): DemandeCircuit {
  const p = determinerParcours({ estDG: false, estFinance: false, estResponsableDeSonService: false }, "STANDARD");
  return { etape, createurId: DEMANDEUR, typeDemande: "STANDARD", ...p, lignes: [ligne("a")] };
}

describe("qui peut réorienter, et quand", () => {
  it("le demandeur réoriente sa demande à l'étape Service, sans permission", () => {
    const r = transition(demande("SERVICE"), acteur(DEMANDEUR), { type: "REORIENTER", motif: MOTIF });
    expect(r).toMatchObject({ ok: true, etapeSuivante: "SERVICE" });
  });
  it("la Finance avec la permission dédiée réoriente ; sans elle, non", () => {
    expect(transition(demande("SERVICE"), FINANCE, { type: "REORIENTER", motif: MOTIF }).ok).toBe(true);
    const r = transition(demande("SERVICE"), FINANCE_SANS, { type: "REORIENTER", motif: MOTIF });
    expect(r).toEqual({ ok: false, message: "Action non autorisée." });
  });
  it("un tiers sans permission est refusé", () => {
    expect(transition(demande("SERVICE"), AUTRE, { type: "REORIENTER", motif: MOTIF }).ok).toBe(false);
  });
  it("seulement pendant l'étape du responsable de service (pas après sa décision)", () => {
    for (const etape of ["FINANCE", "DG", "TERMINEE", "A_CORRIGER", "ABANDONNEE", "DECISION_FINALE"] as const) {
      const r = transition(demande(etape), acteur(DEMANDEUR), { type: "REORIENTER", motif: MOTIF });
      expect(r.ok, etape).toBe(false);
    }
  });
  it("motif obligatoire : 10 caractères minimum, espaces de bord ignorés", () => {
    expect(MOTIF_REORIENTATION_MIN).toBe(10);
    expect(refusMotifReorientation("court")).not.toBeNull();
    expect(refusMotifReorientation("         x        ")).not.toBeNull();
    expect(refusMotifReorientation(undefined)).not.toBeNull();
    expect(refusMotifReorientation("exactement1")).toBeNull();
    const r = transition(demande("SERVICE"), acteur(DEMANDEUR), { type: "REORIENTER", motif: "pas assez" });
    expect(r.ok).toBe(false);
  });
  it("le bouton grisé donne la phrase du serveur", () => {
    expect(raisonIndisponible(demande("SERVICE"), acteur(DEMANDEUR), "REORIENTER")).toBeNull();
    expect(raisonIndisponible(demande("FINANCE"), acteur(DEMANDEUR), "REORIENTER")).toMatch(/étape du responsable de service/);
    expect(raisonIndisponible(demande("SERVICE"), AUTRE, "REORIENTER")).toBe("Action non autorisée.");
  });
  it("l'ancien responsable ne peut plus décider : estResponsableServiceDuDemandeur recalculé = faux", () => {
    // Le serveur recalcule cette valeur depuis la surcharge (`responsableServiceEffectif`) : faux pour l'ancien.
    const ancien = acteur("u-ancien", [], false);
    expect(transition(demande("SERVICE"), ancien, { type: "VALIDER_SERVICE" })).toEqual({
      ok: false,
      message: "Seul le responsable du service du demandeur peut agir à cette étape.",
    });
    const nouveau = acteur("u-nouveau", [], true);
    expect(transition(demande("SERVICE"), nouveau, { type: "VALIDER_SERVICE" }).ok).toBe(true);
  });
});

describe("décideur effectif de l'étape", () => {
  it("la surcharge l'emporte, sinon le responsable du service", () => {
    expect(responsableServiceEffectif({ responsableEtapeServiceId: "nouveau" }, "service")).toBe("nouveau");
    expect(responsableServiceEffectif({ responsableEtapeServiceId: null }, "service")).toBe("service");
    expect(responsableServiceEffectif({}, null)).toBeNull();
  });
});

const cand = (id: string, p: Partial<CandidatResponsable> = {}): CandidatResponsable => ({ id, fullName: `Resp ${id}`, actif: true, services: ["Commercial"], ...p });
const CTX: ContexteReorientation = { actuelId: "actuel", createurId: DEMANDEUR, concernesIds: [DEMANDEUR], absentsIds: [] };

describe("responsables éligibles", () => {
  it("exclut l'actuel, les comptes inactifs, les absents, le demandeur et les bénéficiaires (garde 8)", () => {
    const candidats = [cand("actuel"), cand("inactif", { actif: false }), cand("absent"), cand(DEMANDEUR), cand("benef"), cand("ok2"), cand("ok1")];
    const ctx = { ...CTX, concernesIds: [DEMANDEUR, "benef"], absentsIds: ["absent"] };
    expect(raisonExclusionCandidat(candidats[0], ctx)).toBe("ACTUEL");
    expect(raisonExclusionCandidat(candidats[1], ctx)).toBe("INACTIF");
    expect(raisonExclusionCandidat(candidats[2], ctx)).toBe("ABSENT");
    expect(raisonExclusionCandidat(candidats[3], ctx)).toBe("DEMANDEUR");
    expect(raisonExclusionCandidat(candidats[4], ctx)).toBe("BENEFICIAIRE");
    expect(responsablesEligibles(candidats, ctx).map((c) => c.id)).toEqual(["ok1", "ok2"]);
  });
  it("la cible est revérifiée côté serveur : jamais fiable à la liste affichée", () => {
    const candidats = [cand("actuel"), cand("benef"), cand("ok")];
    const ctx = { ...CTX, concernesIds: [DEMANDEUR, "benef"] };
    expect(refusCibleReorientation("ok", candidats, ctx)).toBeNull();
    expect(refusCibleReorientation("benef", candidats, ctx)).toMatch(/bénéficiaire/);
    expect(refusCibleReorientation("actuel", candidats, ctx)).toMatch(/déjà chez ce responsable/);
    expect(refusCibleReorientation("inconnu", candidats, ctx)).toMatch(/responsable d'aucun service/);
    expect(refusCibleReorientation("", candidats, ctx)).toMatch(/Choisissez/);
  });
  it("réorientations successives : l'ancien décideur redevient éligible une fois remplacé", () => {
    const candidats = [cand("a"), cand("b"), cand("c")];
    // a -> b : a n'est plus l'actuel, il redevient proposable ; b est l'actuel.
    const apres = responsablesEligibles(candidats, { ...CTX, actuelId: "b" });
    expect(apres.map((c) => c.id)).toEqual(["a", "c"]);
  });
});

describe("délai écoulé et historique", () => {
  const t0 = new Date("2026-10-26T08:00:00Z");
  const apres = (ms: number) => new Date(t0.getTime() + ms);
  it("libellé du délai", () => {
    expect(libelleDelaiEcoule(t0, apres(10_000))).toBe("moins d'une minute");
    expect(libelleDelaiEcoule(t0, apres(25 * 60_000))).toBe("25 min");
    expect(libelleDelaiEcoule(t0, apres(5 * 3_600_000 + 12 * 60_000))).toBe("5 h 12 min");
    expect(libelleDelaiEcoule(t0, apres(3 * 86_400_000 + 4 * 3_600_000))).toBe("3 j 4 h");
    expect(libelleDelaiEcoule(t0, apres(2 * 86_400_000))).toBe("2 j");
    expect(libelleDelaiEcoule(t0, apres(-5000))).toBe("moins d'une minute");
  });
  it("la ligne d'historique dit qui, vers qui, pourquoi et le délai (chronomètre remis à zéro)", () => {
    const d = detailReorientation({ de: "Awa", vers: "Koffi", motif: ` ${MOTIF} `, delai: "3 j 4 h", parDemandeur: true });
    expect(d).toContain("Awa → Koffi");
    expect(d).toContain("à la demande du demandeur");
    expect(d).toContain(`motif : ${MOTIF}`);
    expect(d).toContain("délai écoulé chez Awa : 3 j 4 h");
    expect(detailReorientation({ de: "A", vers: "B", motif: MOTIF, delai: "1 h", parDemandeur: false })).toContain("par la Finance");
  });
});

describe("notifications de réorientation", () => {
  const ctx = {
    demandeId: "d1",
    reference: "DEM-2026-000001",
    createurId: DEMANDEUR,
    createurNom: "Aïcha",
    serviceNom: "Commercial",
    montant: 50000,
  } as unknown as ContexteNotificationCircuit;
  const e = { acteurId: DEMANDEUR, ancienId: "ancien", nouveauId: "nouveau", ancienNom: "Awa", nouveauNom: "Koffi", motif: MOTIF, delai: "2 j" };
  it("le nouveau est prévenu à agir, l'ancien est prévenu du retrait ; le demandeur (auteur) n'est pas prévenu de sa propre action", () => {
    const n = notificationsReorientation(ctx, e);
    expect(n.map((x) => x.destinataires)).toEqual([["nouveau"], ["ancien"]]);
    expect(n[0].lien).toBe("/treso/service/d1");
    expect(n[0].message).toContain(MOTIF);
    expect(n[1].titre).toBe("Demande retirée de votre file");
  });
  it("quand la Finance réoriente, le demandeur est informé", () => {
    const n = notificationsReorientation(ctx, { ...e, acteurId: "u-fin" });
    expect(n.map((x) => x.destinataires)).toEqual([["nouveau"], ["ancien"], [DEMANDEUR]]);
    expect(n[2].message).toContain("Koffi");
  });
  it("jamais l'auteur de l'action", () => {
    const n = notificationsReorientation(ctx, { ...e, acteurId: "nouveau" });
    expect(n.flatMap((x) => x.destinataires)).not.toContain("nouveau");
  });
});

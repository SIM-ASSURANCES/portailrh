import { describe, expect, it } from "vitest";
import {
  MOTIF_LEVEE_MIN,
  PHRASE_LEVEE_VERROU,
  VALIDITE_ETAPES_MS,
  debutFenetre,
  lignesEtapes,
  motifLeveeValide,
  refusLeveeVerrou,
  refusPurge,
  refusSauvegarde,
  type EtatEtapes,
} from "./reinitialisationEtapes";
import { estCompteDeTest, planifierDesactivation, type CompteTest } from "./comptesDeTest";

const H = "a".repeat(64);
const etat = (p: Partial<EtatEtapes> = {}): EtatEtapes => ({ verrouActif: false, simulationFaite: false, sauvegardeFaite: false, verrouLeveDansLeFlux: false, ...p });
const statuts = (e: EtatEtapes) => lignesEtapes(e).map((l) => `${l.id}:${l.statut}`);

describe("ordre des étapes", () => {
  it("au départ, seule la simulation est active", () => {
    expect(statuts(etat())).toEqual(["SIMULATION:ACTIVE", "SAUVEGARDE:BLOQUEE", "LEVEE_VERROU:NON_APPLICABLE", "PURGE:BLOQUEE"]);
  });

  it("sans verrou : simulation → sauvegarde → purge", () => {
    expect(statuts(etat({ simulationFaite: true }))).toEqual(["SIMULATION:FAITE", "SAUVEGARDE:ACTIVE", "LEVEE_VERROU:NON_APPLICABLE", "PURGE:BLOQUEE"]);
    expect(statuts(etat({ simulationFaite: true, sauvegardeFaite: true }))).toEqual(["SIMULATION:FAITE", "SAUVEGARDE:FAITE", "LEVEE_VERROU:NON_APPLICABLE", "PURGE:ACTIVE"]);
  });

  it("avec verrou : la levée vient après la sauvegarde et avant la purge", () => {
    const v = { verrouActif: true };
    expect(statuts(etat({ ...v }))).toEqual(["SIMULATION:ACTIVE", "SAUVEGARDE:BLOQUEE", "LEVEE_VERROU:BLOQUEE", "PURGE:BLOQUEE"]);
    expect(statuts(etat({ ...v, simulationFaite: true }))).toEqual(["SIMULATION:FAITE", "SAUVEGARDE:ACTIVE", "LEVEE_VERROU:BLOQUEE", "PURGE:BLOQUEE"]);
    expect(statuts(etat({ ...v, simulationFaite: true, sauvegardeFaite: true }))).toEqual(["SIMULATION:FAITE", "SAUVEGARDE:FAITE", "LEVEE_VERROU:ACTIVE", "PURGE:BLOQUEE"]);
    expect(statuts(etat({ simulationFaite: true, sauvegardeFaite: true, verrouLeveDansLeFlux: true }))).toEqual(["SIMULATION:FAITE", "SAUVEGARDE:FAITE", "LEVEE_VERROU:FAITE", "PURGE:ACTIVE"]);
  });

  it("la sauvegarde ne compte pas sans simulation", () => {
    expect(statuts(etat({ sauvegardeFaite: true }))[1]).toBe("SAUVEGARDE:BLOQUEE");
    expect(statuts(etat({ sauvegardeFaite: true }))[3]).toBe("PURGE:BLOQUEE");
  });
});

describe("refus", () => {
  it("sauvegarde sans simulation", () => {
    expect(refusSauvegarde(etat())).toContain("simulation");
    expect(refusSauvegarde(etat({ simulationFaite: true }))).toBeNull();
  });

  it("purge : pas de simulation, pas de sauvegarde, mauvaise empreinte, verrou actif, mauvaise phrase", () => {
    const ok = { phrase: "REINITIALISER", empreinte: H, empreinteSauvegardee: H };
    const pret = etat({ simulationFaite: true, sauvegardeFaite: true });
    expect(refusPurge(etat(), ok)).toContain("simulation");
    expect(refusPurge(etat({ simulationFaite: true }), ok)).toContain("sauvegarde");
    expect(refusPurge(pret, { ...ok, empreinte: "b".repeat(64) })).toContain("ne correspond pas");
    expect(refusPurge(pret, { ...ok, empreinte: "" })).toContain("ne correspond pas");
    expect(refusPurge({ ...pret, verrouActif: true }, ok)).toContain("verrou");
    expect(refusPurge(pret, { ...ok, phrase: "reinitialiser" })).toContain("REINITIALISER");
    expect(refusPurge(pret, { ...ok, phrase: "" })).toContain("REINITIALISER");
    expect(refusPurge(pret, ok)).toBeNull();
  });

  it("levée du verrou : verrou absent, étapes manquantes, phrase, motif", () => {
    const ok = { phrase: PHRASE_LEVEE_VERROU, motif: "Nouvelle remise à zéro voulue par le DG" };
    const pret = etat({ verrouActif: true, simulationFaite: true, sauvegardeFaite: true });
    expect(refusLeveeVerrou(etat(), ok)).toContain("Aucun verrou");
    expect(refusLeveeVerrou(etat({ verrouActif: true }), ok)).toContain("simulation");
    expect(refusLeveeVerrou(etat({ verrouActif: true, simulationFaite: true }), ok)).toContain("sauvegarde");
    expect(refusLeveeVerrou(pret, { ...ok, phrase: "lever" })).toContain(PHRASE_LEVEE_VERROU);
    expect(refusLeveeVerrou(pret, { ...ok, motif: "court" })).toContain("motif");
    expect(refusLeveeVerrou(pret, { ...ok, motif: "x".repeat(301) })).toContain("motif");
    expect(refusLeveeVerrou(pret, ok)).toBeNull();
  });

  it("motif de levée nettoyé", () => {
    expect(motifLeveeValide("  Motif   valable  ici ")).toBe("Motif valable ici");
    expect(motifLeveeValide("x".repeat(MOTIF_LEVEE_MIN - 1))).toBeNull();
    expect(motifLeveeValide(null)).toBeNull();
  });
});

describe("fenêtre de validité", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  it("4 h par défaut, ou la dernière purge si elle est plus récente", () => {
    expect(debutFenetre(now, null).getTime()).toBe(now.getTime() - VALIDITE_ETAPES_MS);
    const purge = new Date("2026-10-22T10:00:00Z");
    expect(debutFenetre(now, purge)).toEqual(purge);
    expect(debutFenetre(now, new Date("2026-09-26T18:00:00Z")).getTime()).toBe(now.getTime() - VALIDITE_ETAPES_MS);
  });
});

const compte = (id: string, extra: Partial<CompteTest> = {}): CompteTest => ({
  id,
  fullName: `Compte ${id}`,
  email: `${id}@simassurances.test`,
  roleName: "Collaborateur",
  porteReinitialisation: false,
  servicesResponsable: [],
  ...extra,
});

describe("comptes de test", () => {
  it("reconnaît le suffixe, sans tenir compte de la casse", () => {
    expect(estCompteDeTest("dg@simassurances.test")).toBe(true);
    expect(estCompteDeTest("DG@SimAssurances.TEST ")).toBe(true);
    expect(estCompteDeTest("dg@simassurances.com")).toBe(false);
    expect(estCompteDeTest("test@simassurances.test.fr")).toBe(false);
    expect(estCompteDeTest(null)).toBe(false);
  });

  it("désactive des comptes ordinaires", () => {
    const p = planifierDesactivation([compte("a"), compte("b")], ["reel"], "moi");
    expect(p.aDesactiver.map((c) => c.id)).toEqual(["a", "b"]);
    expect(p.refuses).toEqual([]);
  });

  it("refuse le compte connecté", () => {
    const p = planifierDesactivation([compte("moi"), compte("b")], ["reel"], "moi");
    expect(p.aDesactiver.map((c) => c.id)).toEqual(["b"]);
    expect(p.refuses[0].compte.id).toBe("moi");
  });

  it("refuse un responsable de service", () => {
    const p = planifierDesactivation([compte("r", { servicesResponsable: ["Commercial"] })], ["reel"], "moi");
    expect(p.aDesactiver).toEqual([]);
    expect(p.refuses[0].raison).toContain("Commercial");
  });

  it("refuse le dernier compte actif qui porte systeme.reinitialiser", () => {
    const dg = compte("dg", { porteReinitialisation: true, roleName: "DG" });
    const seul = planifierDesactivation([dg, compte("a")], ["dg"], "admin");
    expect(seul.aDesactiver.map((c) => c.id)).toEqual(["a"]);
    expect(seul.refuses[0].raison).toContain("dernier compte");
    // Un autre porteur actif (le vrai DG) reste : le compte de test peut être désactivé.
    const avecReel = planifierDesactivation([dg], ["dg", "reel"], "admin");
    expect(avecReel.aDesactiver.map((c) => c.id)).toEqual(["dg"]);
    // Deux porteurs de test désactivés ensemble, aucun autre : les deux sont refusés.
    const deux = planifierDesactivation([dg, compte("dg2", { porteReinitialisation: true })], ["dg", "dg2"], "admin");
    expect(deux.aDesactiver).toEqual([]);
    expect(deux.refuses).toHaveLength(2);
    // Le porteur connecté (DG réel) n'est pas dans la sélection et reste actif.
    const connecte = planifierDesactivation([dg], ["dg", "moi"], "moi");
    expect(connecte.aDesactiver).toHaveLength(1);
  });
});

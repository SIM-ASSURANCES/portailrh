import { describe, expect, it } from "vitest";
import {
  VALIDITE_ETAPES_MS,
  debutFenetre,
  lignesEtapes,
  messageVerrouActif,
  phraseVerrouEcran,
  refusPurge,
  refusSauvegarde,
  refusSimulation,
  type EtatEtapes,
} from "./reinitialisationEtapes";
import { estCompteDeTest, planifierDesactivation, type CompteTest } from "./comptesDeTest";

const H = "a".repeat(64);
const etat = (p: Partial<EtatEtapes> = {}): EtatEtapes => ({ verrouActif: false, simulationFaite: false, sauvegardeFaite: false, ...p });
const statuts = (e: EtatEtapes) => lignesEtapes(e).map((l) => `${l.id}:${l.statut}`);
const info = { effectueeAt: new Date("2026-09-26T18:08:33Z"), par: "DG Test" };

describe("ordre des étapes", () => {
  it("au départ, seule la simulation est active", () => {
    expect(statuts(etat())).toEqual(["SIMULATION:ACTIVE", "SAUVEGARDE:BLOQUEE", "PURGE:BLOQUEE"]);
  });

  it("simulation → sauvegarde → purge", () => {
    expect(statuts(etat({ simulationFaite: true }))).toEqual(["SIMULATION:FAITE", "SAUVEGARDE:ACTIVE", "PURGE:BLOQUEE"]);
    expect(statuts(etat({ simulationFaite: true, sauvegardeFaite: true }))).toEqual(["SIMULATION:FAITE", "SAUVEGARDE:FAITE", "PURGE:ACTIVE"]);
  });

  it("la sauvegarde ne compte pas sans simulation", () => {
    expect(statuts(etat({ sauvegardeFaite: true }))[1]).toBe("SAUVEGARDE:BLOQUEE");
    expect(statuts(etat({ sauvegardeFaite: true }))[2]).toBe("PURGE:BLOQUEE");
  });

  it("verrou actif : TOUTES les étapes sont bloquées, même simulation et sauvegarde faites, avec la raison du verrou", () => {
    const bloque = ["SIMULATION:BLOQUEE", "SAUVEGARDE:BLOQUEE", "PURGE:BLOQUEE"];
    expect(statuts(etat({ verrouActif: true }))).toEqual(bloque);
    expect(statuts(etat({ verrouActif: true, simulationFaite: true, sauvegardeFaite: true }))).toEqual(bloque);
    for (const l of lignesEtapes(etat({ verrouActif: true }))) expect(l.raison).toContain("verrouillée");
  });

  it("il n'existe plus d'étape de levée du verrou dans l'application", () => {
    expect(lignesEtapes(etat()).map((l) => l.id)).toEqual(["SIMULATION", "SAUVEGARDE", "PURGE"]);
  });
});

describe("verrou définitif (lot S)", () => {
  it("message de refus : date, auteur, fonction verrouillée, levée par UPDATE SQL seulement", () => {
    const m = messageVerrouActif(info);
    expect(m).toMatch(/26\/09\/2026/);
    expect(m).toContain("DG Test");
    expect(m).toContain("verrouillée");
    expect(m).toContain("UPDATE SQL");
    expect(messageVerrouActif(null)).toContain("verrouillée");
  });

  it("phrase de l'écran : « Remise à zéro effectuée le … par …. Fonction verrouillée. »", () => {
    expect(phraseVerrouEcran(info)).toMatch(/^Remise à zéro effectuée le 26\/09\/2026.* par DG Test\. Fonction verrouillée\.$/);
  });

  it("simulation, sauvegarde et purge sont refusées quand le verrou est actif, même si tout le reste est en ordre", () => {
    const pret = etat({ verrouActif: true, simulationFaite: true, sauvegardeFaite: true });
    const ok = { phrase: "REINITIALISER", empreinte: H, empreinteSauvegardee: H };
    for (const refus of [refusSimulation(pret, info), refusSauvegarde(pret, info), refusPurge(pret, ok, info)]) {
      expect(refus).toContain("DG Test");
      expect(refus).toContain("verrouillée");
    }
    expect(refusSimulation(etat())).toBeNull();
  });
});

describe("refus", () => {
  it("sauvegarde sans simulation", () => {
    expect(refusSauvegarde(etat())).toContain("simulation");
    expect(refusSauvegarde(etat({ simulationFaite: true }))).toBeNull();
  });

  it("purge : pas de simulation, pas de sauvegarde, mauvaise empreinte, mauvaise phrase", () => {
    const ok = { phrase: "REINITIALISER", empreinte: H, empreinteSauvegardee: H };
    const pret = etat({ simulationFaite: true, sauvegardeFaite: true });
    expect(refusPurge(etat(), ok)).toContain("simulation");
    expect(refusPurge(etat({ simulationFaite: true }), ok)).toContain("sauvegarde");
    expect(refusPurge(pret, { ...ok, empreinte: "b".repeat(64) })).toContain("ne correspond pas");
    expect(refusPurge(pret, { ...ok, empreinte: "" })).toContain("ne correspond pas");
    expect(refusPurge(pret, { ...ok, phrase: "reinitialiser" })).toContain("REINITIALISER");
    expect(refusPurge(pret, { ...ok, phrase: "" })).toContain("REINITIALISER");
    expect(refusPurge(pret, ok)).toBeNull();
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

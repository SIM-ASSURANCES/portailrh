import { describe, expect, it } from "vitest";

import {
  ageEnJoursCpt,
  clePalierCpt,
  dateLimiteAgeCpt,
  jourTexteCpt,
  libelleAgeCpt,
  lireFiltresSuiviCpt,
  pageDemandeeCpt,
  palierAtteintCpt,
  planifierPaliersCpt,
  seuilDuPalierCpt,
  type LigneAgeeCpt,
  type SeuilsPaliersCpt,
} from "./cptSuiviHebdo";

const SEUILS: SeuilsPaliersCpt = { relanceJours: 7, alerteJours: 30, escaladeJours: 60 };
const MAINTENANT = new Date("2026-11-24T08:00:00Z");

describe("âge d'une ligne", () => {
  it("compte les jours du calendrier, pas des tranches de 24 heures", () => {
    expect(ageEnJoursCpt("2026-11-24", MAINTENANT)).toBe(0);
    expect(ageEnJoursCpt("2026-11-17", MAINTENANT)).toBe(7);
    expect(ageEnJoursCpt(new Date("2026-10-25T23:59:00Z"), MAINTENANT)).toBe(30);
    expect(ageEnJoursCpt("2026-11-30", MAINTENANT)).toBe(-6);
  });
  it("traverse les fins de mois et d'année", () => {
    expect(ageEnJoursCpt("2025-12-31", new Date("2026-01-02T00:00:00Z"))).toBe(2);
  });
  it("la date limite d'un âge minimum est cohérente avec l'âge", () => {
    for (const jours of [7, 30, 60]) {
      const limite = dateLimiteAgeCpt(MAINTENANT, jours);
      expect(ageEnJoursCpt(limite, MAINTENANT)).toBe(jours);
      expect(ageEnJoursCpt(dateLimiteAgeCpt(MAINTENANT, jours - 1), MAINTENANT)).toBe(jours - 1);
    }
    expect(jourTexteCpt(MAINTENANT)).toBe("2026-11-24");
  });
  it("libellé d'âge", () => {
    expect(libelleAgeCpt(0)).toBe("aujourd'hui");
    expect(libelleAgeCpt(1)).toBe("1 jour");
    expect(libelleAgeCpt(12)).toBe("12 jours");
  });
});

describe("paliers 7 / 30 / 60", () => {
  it("le seuil est inclus et le palier le plus élevé l'emporte", () => {
    expect(palierAtteintCpt(6, SEUILS)).toBeNull();
    expect(palierAtteintCpt(7, SEUILS)).toBe("RELANCE");
    expect(palierAtteintCpt(29, SEUILS)).toBe("RELANCE");
    expect(palierAtteintCpt(30, SEUILS)).toBe("ALERTE");
    expect(palierAtteintCpt(59, SEUILS)).toBe("ALERTE");
    expect(palierAtteintCpt(60, SEUILS)).toBe("ESCALADE");
    expect(palierAtteintCpt(400, SEUILS)).toBe("ESCALADE");
  });
  it("suit les seuils paramétrés", () => {
    const s = { relanceJours: 3, alerteJours: 10, escaladeJours: 20 };
    expect(palierAtteintCpt(3, s)).toBe("RELANCE");
    expect(palierAtteintCpt(20, s)).toBe("ESCALADE");
    expect(seuilDuPalierCpt("ALERTE", s)).toBe(10);
  });
});

describe("planification des paliers (idempotence et premier passage)", () => {
  const ligne = (id: string, age: number, objet: LigneAgeeCpt["objet"] = "ENCAISSEMENT"): LigneAgeeCpt => ({ objet, id, age });

  it("envoie le palier atteint, une seule fois", () => {
    const premier = planifierPaliersCpt([ligne("a", 8)], new Set(), SEUILS, false);
    expect(premier.aEnvoyer).toEqual([{ objet: "ENCAISSEMENT", id: "a", palier: "RELANCE" }]);
    expect(premier.silencieux).toEqual([]);
    // Le même jour, ou le lendemain : le palier est réservé, rien ne repart.
    const reserves = new Set([clePalierCpt("ENCAISSEMENT", "a", "RELANCE")]);
    expect(planifierPaliersCpt([ligne("a", 8)], reserves, SEUILS, false)).toEqual({ aEnvoyer: [], silencieux: [] });
    expect(planifierPaliersCpt([ligne("a", 20)], reserves, SEUILS, false)).toEqual({ aEnvoyer: [], silencieux: [] });
  });

  it("à 30 puis 60 jours, chaque palier part une fois", () => {
    let reserves = new Set([clePalierCpt("CONTRAT", "c", "RELANCE")]);
    const alerte = planifierPaliersCpt([ligne("c", 30, "CONTRAT")], reserves, SEUILS, false);
    expect(alerte.aEnvoyer).toEqual([{ objet: "CONTRAT", id: "c", palier: "ALERTE" }]);
    reserves = new Set([...reserves, clePalierCpt("CONTRAT", "c", "ALERTE")]);
    const escalade = planifierPaliersCpt([ligne("c", 60, "CONTRAT")], reserves, SEUILS, false);
    expect(escalade.aEnvoyer).toEqual([{ objet: "CONTRAT", id: "c", palier: "ESCALADE" }]);
  });

  it("une ligne qui franchit plusieurs paliers d'un coup ne reçoit que le plus élevé", () => {
    const plan = planifierPaliersCpt([ligne("x", 45)], new Set(), SEUILS, false);
    expect(plan.aEnvoyer).toEqual([{ objet: "ENCAISSEMENT", id: "x", palier: "ALERTE" }]);
    expect(plan.silencieux).toEqual([{ objet: "ENCAISSEMENT", id: "x", palier: "RELANCE" }]);
  });

  it("au premier passage, tout est réservé sans aucun envoi", () => {
    const plan = planifierPaliersCpt([ligne("a", 8), ligne("b", 45), ligne("c", 90), ligne("d", 2)], new Set(), SEUILS, true);
    expect(plan.aEnvoyer).toEqual([]);
    expect(plan.silencieux.map((r) => `${r.id}:${r.palier}`).sort()).toEqual(["a:RELANCE", "b:ALERTE", "b:RELANCE", "c:ALERTE", "c:ESCALADE", "c:RELANCE"]);
  });

  it("une ligne trop récente ne réserve rien", () => {
    expect(planifierPaliersCpt([ligne("a", 6)], new Set(), SEUILS, false)).toEqual({ aEnvoyer: [], silencieux: [] });
  });

  it("un encaissement et un contrat de même identifiant ne se confondent pas", () => {
    const reserves = new Set([clePalierCpt("ENCAISSEMENT", "z", "RELANCE")]);
    const plan = planifierPaliersCpt([ligne("z", 8, "CONTRAT")], reserves, SEUILS, false);
    expect(plan.aEnvoyer).toEqual([{ objet: "CONTRAT", id: "z", palier: "RELANCE" }]);
  });
});

describe("filtres GET", () => {
  const connus = { comptesIds: ["co-1", "co-2"], partenairesIds: ["pa-1"] };
  it("ignore tout ce qui est invalide, sans lever d'erreur", () => {
    const f = lireFiltresSuiviCpt({ du: "2026-02-30", au: "pas une date", compte: "inconnu", partenaire: "inconnu", branche: "AUTO" }, connus);
    expect(f).toEqual({ du: null, au: null, compteId: null, partenaireId: null, branche: null });
  });
  it("retient les valeurs valides", () => {
    const f = lireFiltresSuiviCpt({ du: "2026-01-01", au: "2026-03-31", compte: "co-2", partenaire: "pa-1", branche: "SANTE" }, connus);
    expect(f).toEqual({ du: "2026-01-01", au: "2026-03-31", compteId: "co-2", partenaireId: "pa-1", branche: "SANTE" });
  });
  it("page demandée : entier d'au moins 1", () => {
    expect(pageDemandeeCpt(undefined)).toBe(1);
    expect(pageDemandeeCpt("0")).toBe(1);
    expect(pageDemandeeCpt("-3")).toBe(1);
    expect(pageDemandeeCpt("abc")).toBe(1);
    expect(pageDemandeeCpt("3")).toBe(3);
    expect(pageDemandeeCpt("2.9")).toBe(2);
  });
});

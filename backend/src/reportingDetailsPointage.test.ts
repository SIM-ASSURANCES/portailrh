import { describe, expect, it } from "vitest";

import { construireRequeteDetails, ligneDetailPointage } from "./pointageReporting";

// Reporting Pointage : détail des retards et des départs anticipés, requête et ligne partagées par l'écran et l'export.
describe("construireRequeteDetails", () => {
  it("retards : arrivées en retard ; départs anticipés : départs avant l'heure", () => {
    expect(construireRequeteDetails("RETARD", {}).where).toMatchObject({ type: "ARRIVEE", estRetard: true });
    expect(construireRequeteDetails("DEPART_ANTICIPE", {}).where).toMatchObject({
      type: "DEPART",
      estDepartAnticipe: true,
    });
  });

  it("sans pagination (export) : aucune limite de lignes", () => {
    const requete = construireRequeteDetails("RETARD", {});
    expect(requete).not.toHaveProperty("take");
    expect(requete).not.toHaveProperty("skip");
  });

  it("avec pagination (écran) : skip et take transmis", () => {
    expect(construireRequeteDetails("DEPART_ANTICIPE", {}, { skip: 50, take: 50 })).toMatchObject({ skip: 50, take: 50 });
  });

  it("mêmes filtres pour les deux détails (collaborateur, service, période jusqu'à la fin du jour)", () => {
    const filtres = { userId: "u1", service: "Commercial", dateDebut: "2026-10-01", dateFin: "2026-10-09" };
    for (const type of ["RETARD", "DEPART_ANTICIPE"] as const) {
      const { where } = construireRequeteDetails(type, filtres);
      expect(where.userId).toBe("u1");
      expect(where.user).toMatchObject({ service: { name: "Commercial" } });
      const heure = where.heure as { gte: Date; lte: Date };
      expect(heure.gte.getTime()).toBe(new Date("2026-10-01").getTime());
      expect(heure.lte.getHours()).toBe(23);
      expect(heure.lte.getMinutes()).toBe(59);
    }
  });
});

describe("ligneDetailPointage", () => {
  const base = {
    id: "p1",
    heure: new Date(2026, 9, 9, 16, 10),
    heurePrevue: "16:45",
    minutesRetard: null,
    motif: null,
    user: { fullName: "Awa", service: { name: "Commercial" } },
  };

  it("départ anticipé décidé : statut, motif de la justification et décidée par", () => {
    const ligne = ligneDetailPointage({
      ...base,
      justification: { statut: "REFUSEE", motif: "Rendez-vous", decideur: { fullName: "Responsable" } },
    });
    expect(ligne).toMatchObject({
      justificationStatut: "REFUSEE",
      justification: "Justification refusée",
      motif: "Rendez-vous",
      decideePar: "Responsable",
      service: "Commercial",
    });
  });

  it("ancien pointage sans justification : repli sur l'ancien motif", () => {
    const ligne = ligneDetailPointage({ ...base, motif: "Ancien motif", justification: null });
    expect(ligne).toMatchObject({ justificationStatut: null, justification: "—", motif: "Ancien motif", decideePar: null });
  });
});

import { describe, expect, it } from "vitest";

import {
  changerResponsableService,
  messageBlocageCreationDemande,
  messageRefusResponsableSansRemplacant,
  servicesQuittesSansRemplacant,
} from "./services";

describe("messageBlocageCreationDemande (création d'une demande)", () => {
  it("autorisée : service avec un responsable actif", () => {
    expect(messageBlocageCreationDemande({ serviceNom: "Commercial", responsableId: "u-1", responsableActif: true })).toBeNull();
  });

  it("refusée : compte sans service", () => {
    expect(messageBlocageCreationDemande({ serviceNom: null, responsableId: null, responsableActif: false })).toMatch(/aucun service/);
  });

  it("refusée : service sans responsable, avec le nom du service", () => {
    expect(messageBlocageCreationDemande({ serviceNom: "Marketing", responsableId: null, responsableActif: false })).toMatch(
      /« Marketing » n'a pas de responsable/
    );
  });

  it("refusée : responsable désactivé", () => {
    expect(messageBlocageCreationDemande({ serviceNom: "Technique", responsableId: "u-2", responsableActif: false })).toMatch(/désactivé/);
  });
});

describe("refus sans remplaçant (désactiver, supprimer, changer de service)", () => {
  it("permis si le compte n'est responsable d'aucun service", () => {
    expect(messageRefusResponsableSansRemplacant("Awa", [], "desactiver")).toBeNull();
  });
  it("refusé avec le nom du compte, l'action et les services", () => {
    expect(messageRefusResponsableSansRemplacant("Awa", ["Commercial"], "desactiver")).toMatch(
      /Impossible de désactiver Awa : c'est le seul responsable du service « Commercial », sans remplaçant/
    );
    expect(messageRefusResponsableSansRemplacant("Awa", ["Commercial", "Marketing"], "supprimer")).toMatch(
      /supprimer Awa .* des services « Commercial », « Marketing »/
    );
    expect(messageRefusResponsableSansRemplacant("Awa", ["Commercial"], "changer_service")).toMatch(/Impossible de changer de service Awa/);
  });
  it("changer de service : seul le service quitté compte (responsable extérieur d'un autre service : permis)", () => {
    const responsabilites = [
      { id: "s-com", name: "Commercial" },
      { id: "s-mkt", name: "Marketing" },
    ];
    expect(servicesQuittesSansRemplacant({ serviceId: "s-com" }, responsabilites, "s-tech")).toEqual(["Commercial"]);
    expect(servicesQuittesSansRemplacant({ serviceId: "s-rh" }, responsabilites, "s-tech")).toEqual([]);
    expect(servicesQuittesSansRemplacant({ serviceId: "s-com" }, responsabilites, "s-com")).toEqual([]);
    expect(servicesQuittesSansRemplacant({ serviceId: null }, responsabilites, "s-tech")).toEqual([]);
  });
});

// Base factice : seules les méthodes appelées par `changerResponsableService`.
function creerDb(opts: { responsableId: string | null; nouveauActif?: boolean; concurrence?: boolean }) {
  const service = { id: "s-com", name: "Commercial", responsableId: opts.responsableId };
  const users: Record<string, { id: string; fullName: string; isActive: boolean }> = {
    "u-ancien": { id: "u-ancien", fullName: "Ancien Resp", isActive: true },
    "u-nouveau": { id: "u-nouveau", fullName: "Nouveau Resp", isActive: opts.nouveauActif ?? true },
  };
  const historique: Record<string, unknown>[] = [];
  const demandes = [
    { id: "d-1", createurId: "u-membre", etapeCircuit: "SERVICE" },
    { id: "d-2", createurId: "u-nouveau", etapeCircuit: "SERVICE" },
  ];
  const db = {
    service: {
      findUnique: async () => ({
        name: service.name,
        responsableId: service.responsableId,
        responsable: service.responsableId ? { id: users[service.responsableId].id, fullName: users[service.responsableId].fullName } : null,
      }),
      updateMany: async ({ where, data }: { where: { responsableId: string | null }; data: { responsableId: string } }) => {
        if (opts.concurrence || where.responsableId !== service.responsableId) return { count: 0 };
        service.responsableId = data.responsableId;
        return { count: 1 };
      },
    },
    user: { findUnique: async ({ where }: { where: { id: string } }) => users[where.id] ?? null },
    demande: { findMany: async () => demandes.map(({ id, createurId }) => ({ id, createurId })) },
    historiqueEntry: { create: async ({ data }: { data: Record<string, unknown> }) => (historique.push(data), data) },
  };
  return { db, service, historique };
}

describe("changerResponsableService (remplacement)", () => {
  it("remplace, transfère les demandes à l'étape Service avec une ligne d'historique chacune", async () => {
    const { db, service, historique } = creerDb({ responsableId: "u-ancien" });
    const r = await changerResponsableService(db as never, { serviceId: "s-com", nouveauResponsableId: "u-nouveau", auteurId: "u-admin" });
    expect(r).toMatchObject({ ok: true, inchange: false, ancien: { fullName: "Ancien Resp" }, nouveau: { fullName: "Nouveau Resp" }, demandesTransferees: 2, demandesDuNouveauResponsable: 1 });
    expect(service.responsableId).toBe("u-nouveau");
    expect(historique).toHaveLength(2);
    expect(historique[0]).toMatchObject({ entity: "Demande", entityId: "d-1", action: "changement_responsable_service", userId: "u-admin" });
    expect(String(historique[0].detail)).toMatch(/Ancien Resp → Nouveau Resp/);
  });
  it("désignation sur un service sans responsable : ancien « aucun »", async () => {
    const { db, historique } = creerDb({ responsableId: null });
    const r = await changerResponsableService(db as never, { serviceId: "s-com", nouveauResponsableId: "u-nouveau", auteurId: "u-admin" });
    expect(r).toMatchObject({ ok: true, ancien: null });
    expect(String(historique[0].detail)).toMatch(/aucun → Nouveau Resp/);
  });
  it("même responsable : rien n'est écrit", async () => {
    const { db, historique } = creerDb({ responsableId: "u-nouveau" });
    const r = await changerResponsableService(db as never, { serviceId: "s-com", nouveauResponsableId: "u-nouveau", auteurId: "u-admin" });
    expect(r).toMatchObject({ ok: true, inchange: true });
    expect(historique).toHaveLength(0);
  });
  it("refusé : compte inactif, aucun choix, ou changement concurrent", async () => {
    const inactif = creerDb({ responsableId: "u-ancien", nouveauActif: false });
    expect(await changerResponsableService(inactif.db as never, { serviceId: "s-com", nouveauResponsableId: "u-nouveau", auteurId: "a" })).toMatchObject({ ok: false, message: expect.stringMatching(/compte actif/) });
    expect(inactif.service.responsableId).toBe("u-ancien");
    expect(await changerResponsableService(inactif.db as never, { serviceId: "s-com", nouveauResponsableId: "", auteurId: "a" })).toMatchObject({ ok: false });
    const course = creerDb({ responsableId: "u-ancien", concurrence: true });
    expect(await changerResponsableService(course.db as never, { serviceId: "s-com", nouveauResponsableId: "u-nouveau", auteurId: "a" })).toMatchObject({ ok: false, message: expect.stringMatching(/entre-temps/) });
    expect(course.historique).toHaveLength(0);
  });
});

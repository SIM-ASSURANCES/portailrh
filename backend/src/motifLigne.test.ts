import { describe, expect, it } from "vitest";

import { champsBeneficiaire } from "./beneficiaire";
import { corrigerEtResoumettre } from "./circuitDemandeDb";
import { motifLigneDemandeur, refusMotifLigne, resumeMotifDemande } from "./motifLigne";

describe("motif de ligne obligatoire", () => {
  it("refusé vide, blanc ou trop court ; accepté à 3 caractères", () => {
    expect(refusMotifLigne("")).toMatch(/Chaque ligne doit avoir un motif \(3 caractères minimum\)/);
    expect(refusMotifLigne("   ")).not.toBeNull();
    expect(refusMotifLigne(null)).not.toBeNull();
    expect(refusMotifLigne("ab")).not.toBeNull();
    expect(refusMotifLigne("abc")).toBeNull();
  });

  it("le demandeur voit sa dernière version, jamais celle modifiée par la Finance", () => {
    expect(motifLigneDemandeur({ motif: "Version Finance", motifOriginal: "Version initiale", motifDemandeur: null })).toBe("Version initiale");
    expect(motifLigneDemandeur({ motif: "Version Finance", motifOriginal: "Initiale", motifDemandeur: "Corrigée" })).toBe("Corrigée");
    expect(motifLigneDemandeur({ motif: "Seule", motifOriginal: null, motifDemandeur: null })).toBe("Seule");
  });
});

describe("ancienne demande lisible", () => {
  it("le motif d'en-tête d'une ancienne demande reste affiché, ses lignes n'ont pas de motif", () => {
    expect(resumeMotifDemande("Renouvellement du parc", [{ libelle: "Écran", motif: null }])).toBe("Renouvellement du parc");
  });
  it("nouvelle demande : les motifs de ses lignes", () => {
    expect(
      resumeMotifDemande(null, [
        { libelle: "Classeurs", motif: "Archivage" },
        { libelle: "Toner", motif: "Imprimante en panne" },
      ])
    ).toBe("Classeurs : Archivage · Toner : Imprimante en panne");
  });
  it("ni en-tête ni motif de ligne : un tiret, jamais d'erreur", () => {
    expect(resumeMotifDemande(null, [{ libelle: "X", motif: null }])).toBe("—");
  });
});

describe("champ « Bénéficiaire »", () => {
  it("moi-même : le compte du demandeur, type Collaborateur", () => {
    expect(champsBeneficiaire({ mode: "MOI" }, "u-moi")).toEqual({
      beneficiaireType: "COLLABORATEUR",
      beneficiaireUserId: "u-moi",
      beneficiaireNom: null,
    });
  });
  it("autre compte : ce compte, type Collaborateur", () => {
    expect(champsBeneficiaire({ mode: "COMPTE", userId: "u-autre" }, "u-moi")).toEqual({
      beneficiaireType: "COLLABORATEUR",
      beneficiaireUserId: "u-autre",
      beneficiaireNom: null,
    });
  });
  it("nom libre : Fournisseur avec le nom saisi, sans compte", () => {
    expect(champsBeneficiaire({ mode: "NOM", nom: "  Bureau Plus SARL " }, "u-moi")).toEqual({
      beneficiaireType: "FOURNISSEUR",
      beneficiaireUserId: null,
      beneficiaireNom: "Bureau Plus SARL",
    });
  });
  it("nom libre « SIM Assurances CI » (toute casse, accents, ponctuation) : type Entreprise", () => {
    for (const nom of ["SIM Assurances CI", "sim assurances", "SIM ASSURANCE CI", "Sim-Assurances, CI"]) {
      expect(champsBeneficiaire({ mode: "NOM", nom }, "u-moi").beneficiaireType, nom).toBe("ENTREPRISE");
    }
    expect(champsBeneficiaire({ mode: "NOM", nom: "SIM Imprimerie" }, "u-moi").beneficiaireType).toBe("FOURNISSEUR");
  });
});

describe("correction et resoumission : motif par ligne", () => {
  type Ligne = Record<string, unknown> & { id: string };
  function fausseBase(typeDemande: "STANDARD" | "DEPENSE_DIRECTE", lignes: Ligne[], description: string | null) {
    const demande = {
      id: "d-1",
      etapeCircuit: "A_CORRIGER",
      createurId: "u-dem",
      beneficiaireUserId: "u-dem",
      typeDemande,
      etapeServiceRequise: true,
      etapeFinanceRequise: true,
      modeEtapeDG: "OPTIONNELLE",
      tourCircuit: 1,
      niveauRejet: "SERVICE",
      motifRejet: "Précisez",
      description,
      descriptionOriginale: null,
      montant: 100,
      lignes,
    };
    const ecrits = { demande: [] as Record<string, unknown>[], lignesMaj: [] as Record<string, unknown>[], lignesCrees: [] as Record<string, unknown>[] };
    const db = {
      demande: {
        findUnique: async () => demande,
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          ecrits.demande.push(data);
          return { count: 1 };
        },
      },
      user: { findUnique: async () => ({ role: { permissions: [] }, service: { name: "Commercial", responsableId: "u-resp" } }) },
      historiqueEntry: { create: async () => ({}) },
      ligneDemande: {
        deleteMany: async () => ({ count: 0 }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          ecrits.lignesMaj.push(data);
          return {};
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          ecrits.lignesCrees.push(data);
          return {};
        },
      },
      pieceJointe: { create: async () => ({}) },
    } as unknown as Parameters<typeof corrigerEtResoumettre>[0];
    return { db, ecrits };
  }
  const ancienneLigne = (autres: Partial<Ligne> = {}): Ligne => ({
    id: "l-1",
    libelle: "Classeurs",
    libelleOriginal: null,
    motif: null,
    motifOriginal: null,
    quantite: 2,
    prixUnitaire: 50,
    statutValidation: "EN_ATTENTE",
    motifRejet: null,
    decidePar: null,
    decideAt: null,
    ...autres,
  });

  it("refusée si une ligne n'a pas de motif (y compris une ancienne ligne qui n'en avait pas)", async () => {
    const { db, ecrits } = fausseBase("STANDARD", [ancienneLigne()], "Ancien motif d'en-tête");
    const r = await corrigerEtResoumettre(db, "d-1", "u-dem", {
      lignes: [{ id: "l-1", libelle: "Classeurs", motif: "", quantite: 2, prixUnitaire: 50 }],
    });
    expect(r).toEqual({ ok: false, message: "Chaque ligne doit avoir un motif (3 caractères minimum)." });
    expect(ecrits.demande).toHaveLength(0);
  });

  it("ancienne demande : motif d'en-tête conservé tel quel, la ligne reçoit son premier motif", async () => {
    const { db, ecrits } = fausseBase("STANDARD", [ancienneLigne()], "Ancien motif d'en-tête");
    const r = await corrigerEtResoumettre(db, "d-1", "u-dem", {
      description: "tentative de réécriture",
      lignes: [{ id: "l-1", libelle: "Classeurs", motif: "Archivage 2026", quantite: 2, prixUnitaire: 50 }],
    });
    expect(r.ok).toBe(true);
    expect(ecrits.demande[0]).not.toHaveProperty("description");
    expect(ecrits.lignesMaj[0]).toMatchObject({ motif: "Archivage 2026", motifDemandeur: "Archivage 2026", motifOriginal: null });
  });

  it("motif modifié : version d'origine posée une fois ; nouvelle ligne créée avec son motif", async () => {
    const { db, ecrits } = fausseBase("STANDARD", [ancienneLigne({ motif: "Archivage" })], null);
    const r = await corrigerEtResoumettre(db, "d-1", "u-dem", {
      lignes: [
        { id: "l-1", libelle: "Classeurs", motif: "Archivage des contrats", quantite: 2, prixUnitaire: 50 },
        { libelle: "Toner", motif: "Imprimante du service", quantite: 1, prixUnitaire: 30 },
      ],
    });
    expect(r.ok).toBe(true);
    expect(ecrits.lignesMaj[0]).toMatchObject({ motif: "Archivage des contrats", motifOriginal: "Archivage" });
    expect(ecrits.lignesCrees[0]).toMatchObject({ libelle: "Toner", motif: "Imprimante du service" });
  });

  it("dépense directe : son motif d'en-tête reste obligatoire et modifiable", async () => {
    const { db } = fausseBase("DEPENSE_DIRECTE", [], "Prime");
    expect((await corrigerEtResoumettre(db, "d-1", "u-dem", { description: "x", lignes: [] })).ok).toBe(false);
    const { db: db2, ecrits } = fausseBase("DEPENSE_DIRECTE", [], "Prime");
    expect((await corrigerEtResoumettre(db2, "d-1", "u-dem", { description: "Prime de stage", lignes: [] })).ok).toBe(true);
    expect(ecrits.demande[0]).toMatchObject({ description: "Prime de stage" });
  });
});

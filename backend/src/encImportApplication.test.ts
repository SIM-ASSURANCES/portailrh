import { describe, expect, it } from "vitest";

import { jourCalendaire, montant } from "./encCalcul";
import { appliquerImportProduction, EncImportApplicationError, type ParametresApplicationImport } from "./encImportApplication";
import type { LigneFichierProduction } from "./encImportLecture";
import { normaliserNomPartenaire } from "./encReferentiels";
import type { LigneAAnalyser } from "./encImportRegles";

// Base de données factice en mémoire, même idiome que `encSequence.test.ts` (« as never » pour éviter de reproduire
// les surcharges exactes du client Prisma généré) : couvre uniquement les méthodes réellement appelées par
// `encImportApplication.ts`. Teste l'ORCHESTRATION (décision → écriture réelle), jamais les règles elles-mêmes
// (déjà couvertes, pures, par `encImportRegles.test.ts`) ni la concurrence réelle (verrous PostgreSQL — voir le test
// Docker dédié).

interface ContratRow {
  id: string;
  numPolice: string;
  S: ReturnType<typeof montant>;
  T: ReturnType<typeof montant>;
  U: ReturnType<typeof montant>;
  V: ReturnType<typeof montant>;
  W: ReturnType<typeof montant>;
  X: ReturnType<typeof montant>;
  [cle: string]: unknown;
}

interface EncaissementRow {
  id: string;
  contratId: string;
  paiementIdFichier: string | null;
  reference: string | null;
  datePaiement: Date;
  Z: ReturnType<typeof montant>;
  statut: string;
  [cle: string]: unknown;
}

function creerDbFactice() {
  let seq = 0;
  const nextId = (prefixe: string) => `${prefixe}-${++seq}`;

  const branches: { id: string; code: string; actif: boolean; libelle?: string }[] = [];
  const mots: { contratId: string; mot: string }[] = [];
  const partenaires = new Map<string, { id: string; cleNom: string; [cle: string]: unknown }>();
  const contrats = new Map<string, ContratRow>(); // clé = numPolice
  const contratsParId = new Map<string, ContratRow>();
  const encaissements: EncaissementRow[] = [];
  const imports: { id: string; [cle: string]: unknown }[] = [];
  const signalements: { id: string; [cle: string]: unknown }[] = [];
  const audits: { id: string; [cle: string]: unknown }[] = [];
  const sequences = new Map<string, number>();

  const db = {
    encBranche: {
      findMany: async () => branches.filter((b) => b.actif).map((b) => ({ id: b.id, code: b.code, libelle: b.libelle ?? b.code })),
    },
    encPartenaire: {
      findUnique: async ({ where }: { where: { cleNom: string } }) => partenaires.get(where.cleNom) ?? null,
      create: async ({ data }: { data: { cleNom: string; [cle: string]: unknown } }) => {
        const row = { id: nextId("partenaire"), ...data };
        partenaires.set(data.cleNom, row);
        return row;
      },
    },
    encContrat: {
      findUnique: async ({ where }: { where: { numPolice: string } }) => {
        const row = contrats.get(where.numPolice);
        if (!row) return null;
        return {
          ...row,
          encaissements: encaissements
            .filter((e) => e.contratId === row.id)
            .map((e) => ({ id: e.id, paiementIdFichier: e.paiementIdFichier, reference: e.reference, datePaiement: e.datePaiement, Z: e.Z, statut: e.statut })),
        };
      },
      create: async ({ data }: { data: Record<string, unknown> & { numPolice: string } }) => {
        const row = { id: nextId("contrat"), ...data } as ContratRow;
        contrats.set(data.numPolice, row);
        contratsParId.set(row.id, row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existant = contratsParId.get(where.id);
        if (!existant) throw new Error(`Contrat introuvable (test) : ${where.id}`);
        const maj = { ...existant, ...data } as ContratRow;
        contratsParId.set(where.id, maj);
        contrats.set(existant.numPolice, maj);
        return maj;
      },
    },
    encEncaissement: {
      create: async ({ data }: { data: Record<string, unknown> & { contratId: string } }) => {
        const row = { id: nextId("enc"), ...data } as EncaissementRow;
        encaissements.push(row);
        return row;
      },
    },
    encImport: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: nextId("import"), ...data };
        imports.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const i = imports.findIndex((r) => r.id === where.id);
        if (i === -1) throw new Error(`Import introuvable (test) : ${where.id}`);
        imports[i] = { ...imports[i], ...data };
        return imports[i];
      },
    },
    encSignalement: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: nextId("signalement"), ...data };
        signalements.push(row);
        return row;
      },
    },
    encContratMot: {
      deleteMany: async ({ where }: { where: { contratId: string } }) => {
        const avant = mots.length;
        for (let i = mots.length - 1; i >= 0; i--) if (mots[i].contratId === where.contratId) mots.splice(i, 1);
        return { count: avant - mots.length };
      },
      createMany: async ({ data }: { data: { contratId: string; mot: string }[] }) => {
        for (const m of data) if (!mots.some((x) => x.contratId === m.contratId && x.mot === m.mot)) mots.push(m);
        return { count: data.length };
      },
    },
    encAudit: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: nextId("audit"), ...data };
        audits.push(row);
        return row;
      },
    },
    encTauxControle: {
      // `findMany` seulement : `resoudreTauxControleAttendus` ne lit jamais cette table autrement. Filtre naïf mais
      // suffisant pour un test — reproduit fidèlement le `OR` de clés (produitCode, partenaireId) envoyé par l'appelant.
      findMany: async ({ where }: { where: { OR: { produitCode: string | null; partenaireId: string | null }[] } }) =>
        tauxControles.filter((t) => where.OR.some((cle) => t.produitCode === cle.produitCode && t.partenaireId === cle.partenaireId)),
    },
    // Verrous de concurrence : sans objet en mono-thread synchrone — no-op (la concurrence réelle est testée contre
    // PostgreSQL, seul système qui exécute vraiment `pg_advisory_xact_lock`).
    $executeRaw: async () => 0,
    // Utilisé uniquement par `prochainNumero`/`prochaineValeur` (encSequence.ts) : le 2ᵉ argument du tagged template
    // est la clé de séquence (`${cle}` dans `VALUES (${cle}, 1)`).
    $queryRaw: async (_strings: TemplateStringsArray, cle: string) => {
      const valeur = (sequences.get(cle) ?? 0) + 1;
      sequences.set(cle, valeur);
      return [{ valeur }];
    },
  };

  const tauxControles: { produitCode: string | null; partenaireId: string | null; tauxTaxe: unknown; tauxCommission: unknown; tauxAccessoires: unknown; tauxHonoraires: unknown }[] = [];

  return { db, branches, partenaires, contrats, encaissements, imports, signalements, audits, tauxControles, mots };
}

function ligneBase(overrides: Partial<LigneFichierProduction> = {}): LigneAAnalyser {
  return {
    numeroLigne: 1,
    dateEnregistrement: jourCalendaire(2026, 9, 1),
    paiementIdFichier: "TECH-000001",
    numPolice: "TST-2026-000001",
    brancheCode: "AUTO",
    typeContrat: "Individuel",
    produitLibelle: "Assurance Auto",
    produitCode: "AUTO01",
    typeOperation: "Nouvelle affaire",
    clientId: "CLI-001",
    clientNom: "Client Test",
    partenaireNom: "Partenaire Test",
    datePaiement: jourCalendaire(2026, 9, 10),
    mode: "CHEQUE",
    reference: "CHQ-000001",
    dateEffet: jourCalendaire(2026, 9, 1),
    dateEcheance: jourCalendaire(2027, 9, 1),
    S: montant("1500"),
    T: montant("1398.60"),
    U: montant("0"),
    V: montant("101.40"),
    W: montant("251.75"),
    X: montant("34.97"),
    typePolice: "Standard",
    Z: montant("500"),
    ...overrides,
  };
}

const PARAMS_BASE: ParametresApplicationImport = {
  nomFichier: "production-2026-09.xlsx",
  sha256: "0".repeat(64),
  fichierId: "piece-1",
  brancheParDefaut: null,
  origineImport: "EQUIPE_TECHNIQUE",
  importeParId: "user-1",
  maintenant: jourCalendaire(2026, 9, 30),
  toleranceIncoherenceFcfa: "1",
  ip: null,
};

describe("appliquerImportProduction — orchestration (base factice en mémoire)", () => {
  it("refuse l'import ENTIER si une branche du fichier est inconnue : rien n'est écrit", async () => {
    const { db, imports, contrats, signalements } = creerDbFactice();
    // Aucune branche active dans `db` : "AUTO" (porté par `ligneBase()`) est donc inconnue.
    await expect(appliquerImportProduction(db as never, [ligneBase()], PARAMS_BASE)).rejects.toThrow(EncImportApplicationError);
    await expect(appliquerImportProduction(db as never, [ligneBase()], PARAMS_BASE)).rejects.toThrow(/AUTO/);
    expect(imports).toHaveLength(0);
    expect(contrats.size).toBe(0);
    expect(signalements).toHaveLength(0);
  });

  it("police nouvelle avec paiement complet → crée le contrat et l'encaissement (A_CONFIRMER), signale AJOUTE", async () => {
    const { db, branches, contrats, encaissements, signalements } = creerDbFactice();
    branches.push({ id: "branche-auto", code: "AUTO", actif: true });

    const resultat = await appliquerImportProduction(db as never, [ligneBase()], PARAMS_BASE);

    expect(resultat.nbContratsCrees).toBe(1);
    expect(resultat.nbContratsMaj).toBe(0);
    expect(resultat.nbPaiementsAConfirmer).toBe(1);
    expect(resultat.nbATraiter).toBe(0);
    expect(resultat.nbInfo).toBe(1);

    expect(contrats.size).toBe(1);
    expect(encaissements).toHaveLength(1);
    expect(encaissements[0].statut).toBe("A_CONFIRMER");
    expect(encaissements[0].paiementId).toMatch(/^PAI-2026-\d{6}$/);

    expect(signalements).toHaveLength(1);
    expect(signalements[0].analyse).toBe("AJOUTE");
    expect(signalements[0].encaissementCreeId).toBe(encaissements[0].id);
  });

  it("réimport EXACT de la même ligne → déjà présent, aucun nouveau contrat ni paiement créé", async () => {
    const { db, branches, contrats, encaissements, signalements } = creerDbFactice();
    branches.push({ id: "branche-auto", code: "AUTO", actif: true });

    const premier = await appliquerImportProduction(db as never, [ligneBase()], PARAMS_BASE);
    expect(premier.nbContratsCrees).toBe(1);
    expect(premier.nbPaiementsAConfirmer).toBe(1);

    const second = await appliquerImportProduction(db as never, [ligneBase()], PARAMS_BASE);

    // Le contrat est TOUJOURS remis à jour depuis le fichier (CDC §3.1) — jamais recréé : nbContratsMaj, pas
    // nbContratsCrees. Aucun nouveau paiement : la ligne est reconnue "déjà présente".
    expect(second.nbContratsCrees).toBe(0);
    expect(second.nbContratsMaj).toBe(1);
    expect(second.nbPaiementsAConfirmer).toBe(0);

    expect(contrats.size).toBe(1); // toujours un seul contrat, jamais un doublon
    expect(encaissements).toHaveLength(1); // toujours un seul encaissement, jamais recréé

    const signalementsSecondImport = signalements.filter((s) => s.importId !== premier.importId);
    expect(signalementsSecondImport).toHaveLength(1);
    expect(signalementsSecondImport[0].analyse).toBe("DEJA_PRESENT");
    expect(signalementsSecondImport[0].encaissementExistantId).toBe(encaissements[0].id);
  });

  it("crée un partenaire automatiquement, puis le réutilise pour une seconde ligne référençant le même nom", async () => {
    const { db, branches, partenaires, contrats } = creerDbFactice();
    branches.push({ id: "branche-auto", code: "AUTO", actif: true });

    const ligne1 = ligneBase({ numPolice: "TST-2026-000001", partenaireNom: "Le Partenaire" });
    const ligne2 = ligneBase({ numPolice: "TST-2026-000002", paiementIdFichier: "TECH-000002", partenaireNom: "LE   partenaire" });

    await appliquerImportProduction(db as never, [ligne1, ligne2], PARAMS_BASE);

    expect(partenaires.size).toBe(1); // même nom normalisé : un seul partenaire, jamais deux
    const cle = normaliserNomPartenaire("Le Partenaire");
    expect(partenaires.get(cle)).toBeDefined();

    const c1 = contrats.get("TST-2026-000001")!;
    const c2 = contrats.get("TST-2026-000002")!;
    expect(c1.partenaireId).toBe(c2.partenaireId);
  });

  it("ligne sans numéro de police : signalée seule (A_COMPLETER), jamais de contrat ni de paiement créé", async () => {
    const { db, branches, contrats, encaissements, signalements } = creerDbFactice();
    branches.push({ id: "branche-auto", code: "AUTO", actif: true });

    const resultat = await appliquerImportProduction(db as never, [ligneBase({ numPolice: null })], PARAMS_BASE);

    expect(resultat.nbContratsCrees).toBe(0);
    expect(resultat.nbContratsMaj).toBe(0);
    expect(resultat.nbPaiementsAConfirmer).toBe(0);
    expect(resultat.nbATraiter).toBe(1);
    expect(contrats.size).toBe(0);
    expect(encaissements).toHaveLength(0);
    expect(signalements).toHaveLength(1);
    expect(signalements[0].analyse).toBe("A_COMPLETER");
    expect(signalements[0].numPolice).toBeNull();
  });

  it("enregistre sur l'import les branches lues dans le fichier (triées, sans doublon), jamais la branche par défaut", async () => {
    const { db, branches, imports } = creerDbFactice();
    branches.push({ id: "b-auto", code: "AUTO", actif: true }, { id: "b-sante", code: "SANTE", actif: true });

    await appliquerImportProduction(
      db as never,
      [
        ligneBase({ numPolice: "P-1", paiementIdFichier: "F-1", brancheCode: "SANTE" }),
        ligneBase({ numPolice: "P-2", paiementIdFichier: "F-2", brancheCode: "AUTO" }),
        ligneBase({ numPolice: "P-3", paiementIdFichier: "F-3", brancheCode: "SANTE" }),
      ],
      PARAMS_BASE
    );
    expect(imports[0].branchesFichier).toEqual(["AUTO", "SANTE"]);

    // Fichier sans colonne « Branche » : branche choisie à l'écran, rien n'est enregistré comme « lu dans le fichier ».
    await appliquerImportProduction(db as never, [ligneBase({ numPolice: "P-4", paiementIdFichier: "F-4", brancheCode: null })], {
      ...PARAMS_BASE,
      brancheParDefaut: "AUTO",
    });
    expect(imports[1].branchesFichier).toBeUndefined();
  });

  it("écart de taux de contrôle : silencieux sans EncTauxControle, signalé (ECART_TAUX) dès qu'une ligne existe pour le produit", async () => {
    const { db, branches, tauxControles, signalements } = creerDbFactice();
    branches.push({ id: "branche-auto", code: "AUTO", actif: true });

    // 1er import, AUCUNE ligne EncTauxControle : `analyserLigne` (4b) saute le contrôle — zéro ECART_TAUX.
    await appliquerImportProduction(db as never, [ligneBase()], PARAMS_BASE);
    expect(signalements.some((s) => s.analyse === "ECART_TAUX")).toBe(false);

    // Ajoute une ligne EncTauxControle pour CE produit (produitCode "AUTO01", `ligneBase()`) — commission attendue à
    // 50 %, très éloignée du taux réel (W/T = 251.75/1398.60 ≈ 18 %) : écart très supérieur à la tolérance
    // provisoire (2 points). 2ᵉ import, police DIFFÉRENTE (jamais celle du 1er, pour ne pas déclencher un avenant).
    tauxControles.push({ produitCode: "AUTO01", partenaireId: null, tauxTaxe: null, tauxCommission: montant("0.5"), tauxAccessoires: null, tauxHonoraires: null });
    await appliquerImportProduction(db as never, [ligneBase({ numPolice: "TST-2026-000002", paiementIdFichier: "TECH-000002" })], PARAMS_BASE);

    const ecarts = signalements.filter((s) => s.analyse === "ECART_TAUX");
    expect(ecarts).toHaveLength(1);
    expect(ecarts[0].detail).toContain("commission");
  });

  it("index de recherche (5a-bis) : mots du contrat écrits à la création, réécrits avec la nouvelle référence", async () => {
    const { db, branches, mots } = creerDbFactice();
    branches.push({ id: "branche-auto", code: "AUTO", actif: true, libelle: "Automobile" });

    await appliquerImportProduction(db as never, [ligneBase({ clientNom: "N'Guessan Kouamé" })], PARAMS_BASE);
    const apres1 = mots.map((m) => m.mot).sort();
    for (const attendu of ["tst2026000001", "tst", "000001", "nguessan", "guessan", "kouame", "partenaire", "automobile", "auto", "chq000001"]) {
      expect(apres1).toContain(attendu);
    }

    const ligne2 = ligneBase({ clientNom: "N'Guessan Kouamé", paiementIdFichier: "TECH-000002", reference: "OM-777", datePaiement: jourCalendaire(2026, 9, 20) });
    await appliquerImportProduction(db as never, [ligne2], PARAMS_BASE);
    const apres2 = mots.map((m) => m.mot);
    expect(apres2).toContain("chq000001"); // référence déjà enregistrée, toujours indexée
    expect(apres2).toContain("om777"); // nouvelle référence
    expect(new Set(apres2).size).toBe(apres2.length); // jamais de doublon
  });

  it("paiement indiqué : conserve le PaiementID du fichier et le n° de ligne (5c, « Ajouter quand même »)", async () => {
    const { db, branches, signalements } = creerDbFactice();
    branches.push({ id: "branche-auto", code: "AUTO", actif: true });
    await appliquerImportProduction(db as never, [ligneBase({ numeroLigne: 7, paiementIdFichier: "FX-0007" })], PARAMS_BASE);
    expect(signalements[0].paiementIndique).toMatchObject({ paiementIdFichier: "FX-0007", numeroLigne: 7, reference: "CHQ-000001", montant: "500.00" });
  });
});

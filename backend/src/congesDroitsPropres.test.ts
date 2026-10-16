// A1 (relecture du 2026-10-16) : la RH ne modifie jamais ses propres droits à congé.
// Base simulée minimale : seules les lectures/écritures de `ajusterSolde` et `modifierDateEmbauche` existent ; toute autre
// écriture ferait échouer le test (la fonction est appelée sans base réelle).

import { describe, expect, it, vi } from "vitest";

vi.mock("./prisma", () => ({ prisma: {} }));

import {
  MESSAGE_AJUSTEMENT_PROPRE_SOLDE,
  MESSAGE_DATE_EMBAUCHE_PROPRE,
  RefusAbsence,
  ajusterSolde,
  modifierDateEmbauche,
  type Db,
} from "./congesDb";

function faussebase(soldeUserId: string) {
  const ecritures: string[] = [];
  const db = {
    soldeConge: {
      findUnique: vi.fn(async (args: { select?: { soldeRestant?: boolean } }) =>
        args.select?.soldeRestant ? { soldeRestant: 12, userId: soldeUserId } : { userId: soldeUserId }
      ),
      updateMany: vi.fn(async () => {
        ecritures.push("soldeConge.updateMany");
        return { count: 1 };
      }),
      findUniqueOrThrow: vi.fn(async () => ({ soldeRestant: 12, userId: soldeUserId })),
    },
    ajustementSolde: {
      create: vi.fn(async () => {
        ecritures.push("ajustementSolde.create");
        return {};
      }),
    },
    user: {
      findUnique: vi.fn(async () => ({ dateEmbauche: null, fullName: "Quelqu'un" })),
      update: vi.fn(async () => {
        ecritures.push("user.update");
        return {};
      }),
    },
    historiqueEntry: {
      create: vi.fn(async () => {
        ecritures.push("historiqueEntry.create");
        return {};
      }),
    },
  };
  return { db: db as unknown as Db, ecritures };
}

describe("ajusterSolde — pas pour soi-même", () => {
  it("refuse l'ajustement de son propre solde, sans aucune écriture", async () => {
    const { db, ecritures } = faussebase("rh-1");
    const p = ajusterSolde(db, { soldeCongeId: "s1", montant: 100, motif: "Régularisation", acteurId: "rh-1" });
    await expect(p).rejects.toBeInstanceOf(RefusAbsence);
    await expect(p).rejects.toThrow(MESSAGE_AJUSTEMENT_PROPRE_SOLDE);
    expect(ecritures).toEqual([]);
  });

  it("accepte l'ajustement du solde d'un autre compte", async () => {
    const { db, ecritures } = faussebase("collab-1");
    const r = await ajusterSolde(db, { soldeCongeId: "s1", montant: 2, motif: "Régularisation", acteurId: "rh-1" });
    expect(r.soldeRestant).toBe(12);
    expect(ecritures).toEqual(["soldeConge.updateMany", "ajustementSolde.create", "historiqueEntry.create"]);
  });

  it("garde la phrase attendue", () => {
    expect(MESSAGE_AJUSTEMENT_PROPRE_SOLDE).toBe("Vous ne pouvez pas ajuster votre propre solde : un autre compte RH ou le DG doit le faire.");
  });
});

describe("modifierDateEmbauche — pas pour soi-même", () => {
  it("refuse la modification de sa propre date d'embauche, sans aucune écriture", async () => {
    const { db, ecritures } = faussebase("x");
    const p = modifierDateEmbauche(db, { userId: "rh-1", date: "2020-01-01", acteurId: "rh-1" });
    await expect(p).rejects.toBeInstanceOf(RefusAbsence);
    await expect(p).rejects.toThrow(MESSAGE_DATE_EMBAUCHE_PROPRE);
    expect(ecritures).toEqual([]);
  });

  it("accepte la date d'embauche d'un autre compte", async () => {
    const { db, ecritures } = faussebase("x");
    await modifierDateEmbauche(db, { userId: "collab-1", date: "2020-01-01", acteurId: "rh-1" });
    expect(ecritures).toEqual(["user.update", "historiqueEntry.create"]);
  });
});

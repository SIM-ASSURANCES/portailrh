import { describe, expect, it } from "vitest";

import { confirmerEnLot, LOT_MAX, marquerNonRecu, marquerNonRecuEnLot } from "./encConfirmationLot";
import { EncConfirmationError } from "./encConfirmation";
import { ENC_PARAMETRES } from "./encParametres";

const j = (a: number, m: number, d: number) => new Date(Date.UTC(a, m - 1, d));
type Enc = Record<string, unknown> & { id: string; statut: string; contratId: string };

// Base simulée (même idiome que encConfirmation.test.ts) ; `$transaction` exécute la fonction sur la même base.
function creerBase(encaissements: Enc[]) {
  const audits: Record<string, unknown>[] = [];
  const contrat = { numPolice: "POL-A", S: "1500", T: "1398.60", U: "0", V: "101.40", W: "251.75", X: "34.97", partAccessoiresPartenaire: null, partenaire: null };
  const db = {
    $executeRaw: async () => 1,
    encEncaissement: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const e = encaissements.find((x) => x.id === where.id);
        return e ? { ...e, contrat } : null;
      },
      findMany: async ({ where }: { where: { contratId: string; statut: string } }) =>
        encaissements.filter((e) => e.contratId === where.contratId && e.statut === where.statut),
      aggregate: async ({ where }: { where: { contratId: string; statut: string } }) => ({
        _max: {
          ordrePriseEnCompte: encaissements
            .filter((e) => e.contratId === where.contratId && e.statut === where.statut)
            .reduce<number | null>((m, e) => Math.max(m ?? 0, e.ordrePriseEnCompte as number), null),
        },
      }),
      updateMany: async ({ where, data }: { where: { id: string; statut: string }; data: Record<string, unknown> }) => {
        const e = encaissements.find((x) => x.id === where.id && x.statut === where.statut);
        if (!e) return { count: 0 };
        Object.assign(e, data);
        return { count: 1 };
      },
    },
    encParametre: { findMany: async () => ENC_PARAMETRES.map((p) => ({ cle: p.cle, valeur: p.defaut })) },
    encBeneficiaireHonoraires: { findMany: async () => [{ id: "b-nov", nom: "NOVELIA", dateDebut: j(2000, 1, 1) }] },
    encAudit: { create: async ({ data }: { data: Record<string, unknown> }) => (audits.push(data), data) },
  };
  const client = { $transaction: async <T>(fn: (tx: never) => Promise<T>) => fn(db as never) };
  return { db: db as never, client, audits };
}
const enc = (id: string, Z: string, statut = "A_CONFIRMER"): Enc => ({ id, paiementId: `PAI-${id}`, statut, contratId: "c-A", datePaiement: j(2026, 9, 1), Z });
const MAINTENANT = new Date(Date.UTC(2026, 9, 8, 10));

describe("cas 9.2 — paiement du fichier technique (partie serveur)", () => {
  it("à confirmer : rien de figé ; après « Reçu » : AA à AD calculés", async () => {
    const encs = [enc("e1", "500")];
    const { client } = creerBase(encs);
    expect([encs[0].AA, encs[0].AD]).toEqual([undefined, undefined]);
    const bilan = await confirmerEnLot(client as never, { ids: ["e1"], userId: "u-fin", maintenant: MAINTENANT });
    expect(bilan.traites.map((t) => t.paiementId)).toEqual(["PAI-e1"]);
    expect(encs[0]).toMatchObject({ statut: "CONFIRME", AA: "1000.00", AB: "466.20", AC: "0.00", AD: "33.80" });
  });

  it("« Non reçu » (motif « absent du relevé Wave ») : rien ne compte, motif et auteur tracés", async () => {
    const encs = [enc("e1", "500")];
    const { db, audits } = creerBase(encs);
    await marquerNonRecu(db, { encaissementId: "e1", motif: "  absent du relevé Wave ", userId: "u-fin", maintenant: MAINTENANT });
    expect(encs[0]).toMatchObject({ statut: "NON_RECU", motifNonReception: "absent du relevé Wave", nonRecuParId: "u-fin", nonRecuAt: MAINTENANT });
    expect(encs[0].AD).toBeUndefined();
    expect(audits[0]).toMatchObject({ action: "non_recu", motif: "absent du relevé Wave" });
  });
});

describe("« Non reçu »", () => {
  it("motif obligatoire (3 caractères minimum) ; seulement depuis « à confirmer »", async () => {
    const encs = [enc("e1", "500"), enc("e2", "500", "CONFIRME"), enc("e3", "500", "NON_RECU")];
    const { db } = creerBase(encs);
    await expect(marquerNonRecu(db, { encaissementId: "e1", motif: " ab ", userId: "u", maintenant: MAINTENANT })).rejects.toThrow(/motif est obligatoire/);
    for (const id of ["e2", "e3"]) {
      await expect(marquerNonRecu(db, { encaissementId: id, motif: "absent", userId: "u", maintenant: MAINTENANT })).rejects.toThrow(/Seul un paiement « à confirmer »/);
    }
    expect(encs[0].statut).toBe("A_CONFIRMER");
  });
});

describe("lots", () => {
  it("« Reçu » en lot : le trop-perçu est écarté (D30), le déjà-traité est refusé, les autres sont confirmés", async () => {
    // e3 déjà confirmé (100) ; e1 500 confirmé ; e2 2 000 dépasse le restant de 900 (trop-perçu 1 100) ; e4 300 confirmé.
    const encs = [enc("e1", "500"), enc("e2", "2000"), { ...enc("e3", "100", "CONFIRME"), ordrePriseEnCompte: 1, Z: "100", AB: "93.24", AC: "0", AD: "6.76", commission: "16.78", honoraires: "2.33" }, enc("e4", "300")];
    const { client } = creerBase(encs);
    const bilan = await confirmerEnLot(client as never, { ids: ["e1", "e2", "e3", "e4", "e1"], userId: "u", maintenant: MAINTENANT });
    expect(bilan.traites.map((t) => t.paiementId)).toEqual(["PAI-e1", "PAI-e4"]);
    expect(bilan.tropPercus).toEqual([{ id: "e2", paiementId: "PAI-e2", tropPercu: "1100.00" }]);
    expect(bilan.refuses.map((r) => r.id)).toEqual(["e3"]);
    expect(encs[1].statut).toBe("A_CONFIRMER");
    expect([encs[0].ordrePriseEnCompte, encs[3].ordrePriseEnCompte]).toEqual([2, 3]);
  });

  it("« Non reçu » en lot : même motif pour tous, motif obligatoire", async () => {
    const encs = [enc("e1", "500"), enc("e2", "500", "CONFIRME")];
    const { client } = creerBase(encs);
    await expect(marquerNonRecuEnLot(client as never, { ids: ["e1"], motif: "", userId: "u", maintenant: MAINTENANT })).rejects.toThrow(/motif/);
    const bilan = await marquerNonRecuEnLot(client as never, { ids: ["e1", "e2"], motif: "absent du relevé", userId: "u", maintenant: MAINTENANT });
    expect([bilan.traites.map((t) => t.id), bilan.refuses.map((r) => r.id)]).toEqual([["e1"], ["e2"]]);
  });

  it("lot vide ou trop grand : refusé", async () => {
    const { client } = creerBase([]);
    await expect(confirmerEnLot(client as never, { ids: [], userId: "u", maintenant: MAINTENANT })).rejects.toThrow(EncConfirmationError);
    const trop = Array.from({ length: LOT_MAX + 1 }, (_, i) => `e${i}`);
    await expect(confirmerEnLot(client as never, { ids: trop, userId: "u", maintenant: MAINTENANT })).rejects.toThrow(/au plus par lot/);
  });
});

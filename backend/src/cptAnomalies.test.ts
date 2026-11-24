import { describe, expect, it } from "vitest";

import {
  ANOMALIES_PAR_LOT_MAX_CPT,
  MESSAGE_ANOMALIE_DEJA_TRAITEE_CPT,
  MESSAGE_ANOMALIE_INTROUVABLE_CPT,
  nettoyerResolutionCpt,
  RESOLUTION_MAX_CPT,
  RESOLUTION_PAR_DEFAUT_CPT,
  traiterAnomaliesCpt,
  traiterAnomalieCpt,
} from "./cptAnomalies";

interface Ligne {
  id: string;
  type: string;
  statut: "A_TRAITER" | "TRAITEE";
  traiteeParId?: string;
  resolution?: string;
}

/** Base simulée en mémoire : assez pour vérifier la condition de statut, l'audit et les compteurs. */
function fausseBase(lignes: Ligne[]) {
  const audits: Record<string, unknown>[] = [];
  const db = {
    cptAnomalie: {
      findUnique: async ({ where }: { where: { id: string } }) => lignes.find((l) => l.id === where.id) ?? null,
      updateMany: async ({ where, data }: { where: { id: string; statut: string }; data: Partial<Ligne> }) => {
        const l = lignes.find((x) => x.id === where.id && x.statut === where.statut);
        if (!l) return { count: 0 };
        Object.assign(l, data);
        return { count: 1 };
      },
    },
    cptAudit: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return data;
      },
    },
  } as never;
  return { db, audits, lignes };
}

describe("conclusion saisie", () => {
  it("facultative : à défaut, « Marquée traitée »", () => {
    expect(nettoyerResolutionCpt(undefined)).toEqual({ ok: true, resolution: RESOLUTION_PAR_DEFAUT_CPT });
    expect(nettoyerResolutionCpt(null)).toEqual({ ok: true, resolution: RESOLUTION_PAR_DEFAUT_CPT });
    expect(nettoyerResolutionCpt("   ")).toEqual({ ok: true, resolution: RESOLUTION_PAR_DEFAUT_CPT });
  });

  it("espaces réduits, bords retirés ; plus de 500 caractères refusé ; autre type refusé", () => {
    expect(nettoyerResolutionCpt("  Partenaire   créé  depuis ")).toEqual({ ok: true, resolution: "Partenaire créé depuis" });
    expect(nettoyerResolutionCpt("x".repeat(RESOLUTION_MAX_CPT))).toMatchObject({ ok: true });
    expect(nettoyerResolutionCpt("x".repeat(RESOLUTION_MAX_CPT + 1))).toMatchObject({ ok: false });
    expect(nettoyerResolutionCpt(42)).toMatchObject({ ok: false });
  });
});

describe("traiter une anomalie", () => {
  it("passe à TRAITEE avec le traitant et la conclusion, et écrit une ligne d'audit", async () => {
    const { db, audits, lignes } = fausseBase([{ id: "a1", type: "PARTENAIRE_INCONNU", statut: "A_TRAITER" }]);
    const r = await traiterAnomalieCpt(db, "a1", { userId: "u1", resolution: "Partenaire créé depuis", ip: "10.0.0.1" });
    expect(r).toEqual({ ok: true });
    expect(lignes[0]).toMatchObject({ statut: "TRAITEE", traiteeParId: "u1", resolution: "Partenaire créé depuis" });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ entite: "CptAnomalie", entiteId: "a1", action: "traitement", userId: "u1", motif: "Partenaire créé depuis" });
  });

  it("une anomalie déjà traitée n'est pas retraitée : aucun audit de plus", async () => {
    const { db, audits } = fausseBase([{ id: "a1", type: "X", statut: "TRAITEE" }]);
    expect(await traiterAnomalieCpt(db, "a1", { userId: "u2" })).toEqual({ ok: false, message: MESSAGE_ANOMALIE_DEJA_TRAITEE_CPT });
    expect(audits).toHaveLength(0);
  });

  it("une anomalie inconnue est refusée avec son message, sans audit", async () => {
    const { db, audits } = fausseBase([]);
    expect(await traiterAnomalieCpt(db, "zz", { userId: "u1" })).toEqual({ ok: false, message: MESSAGE_ANOMALIE_INTROUVABLE_CPT });
    expect(audits).toHaveLength(0);
  });

  it("une conclusion invalide n'écrit rien", async () => {
    const { db, audits, lignes } = fausseBase([{ id: "a1", type: "X", statut: "A_TRAITER" }]);
    const r = await traiterAnomalieCpt(db, "a1", { userId: "u1", resolution: "y".repeat(RESOLUTION_MAX_CPT + 1) });
    expect(r.ok).toBe(false);
    expect(lignes[0].statut).toBe("A_TRAITER");
    expect(audits).toHaveLength(0);
  });
});

describe("traiter en lot", () => {
  it("compte les traitées, les déjà traitées et les inconnues ; les doublons de la liste comptent une fois", async () => {
    const { db, audits } = fausseBase([
      { id: "a1", type: "X", statut: "A_TRAITER" },
      { id: "a2", type: "X", statut: "A_TRAITER" },
      { id: "a3", type: "X", statut: "TRAITEE" },
    ]);
    const r = await traiterAnomaliesCpt(db, ["a1", "a2", "a2", "a3", "inconnue"], { userId: "u1", resolution: "Vu" });
    expect(r).toEqual({ ok: true, bilan: { traitees: 2, dejaTraitees: 1, introuvables: 1 } });
    expect(audits).toHaveLength(2);
  });

  it("refuse une sélection vide, trop grande, ou une conclusion invalide — sans rien écrire", async () => {
    const { db, audits } = fausseBase([{ id: "a1", type: "X", statut: "A_TRAITER" }]);
    expect(await traiterAnomaliesCpt(db, [], { userId: "u1" })).toMatchObject({ ok: false });
    const trop = Array.from({ length: ANOMALIES_PAR_LOT_MAX_CPT + 1 }, (_, i) => `id${i}`);
    expect(await traiterAnomaliesCpt(db, trop, { userId: "u1" })).toMatchObject({ ok: false });
    expect(await traiterAnomaliesCpt(db, ["a1"], { userId: "u1", resolution: 12 })).toMatchObject({ ok: false });
    expect(audits).toHaveLength(0);
  });
});

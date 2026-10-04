import { describe, expect, it } from "vitest";

import { COMMENTAIRE_TRAITEMENT_MAX, EncSignalementError, marquerSignalementTraite, resolutionMarqueTraite } from "./encSignalements";

// Base factice : seules les méthodes appelées par `marquerSignalementTraite` (même idiome que encImportApplication.test.ts).
function creerDb(statut: string) {
  const signalement: Record<string, unknown> = { id: "sig-1", statut, analyse: "DOUBLON_POSSIBLE", numPolice: "POL-1" };
  const audits: Record<string, unknown>[] = [];
  const db = {
    encSignalement: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === signalement.id ? { ...signalement } : null),
      updateMany: async ({ where, data }: { where: { id: string; statut: string }; data: Record<string, unknown> }) => {
        if (where.id !== signalement.id || signalement.statut !== where.statut) return { count: 0 };
        Object.assign(signalement, data);
        return { count: 1 };
      },
    },
    encAudit: { create: async ({ data }: { data: Record<string, unknown> }) => (audits.push(data), data) },
  };
  return { db, signalement, audits };
}

const MAINTENANT = new Date(Date.UTC(2026, 9, 4, 10));

describe("marquerSignalementTraite (5b)", () => {
  it("À TRAITER → TRAITÉ : auteur, date, résolution avec commentaire, audit", async () => {
    const { db, signalement, audits } = creerDb("A_TRAITER");
    await marquerSignalementTraite(db as never, { signalementId: "sig-1", userId: "u-1", commentaire: "  vu avec le partenaire ", maintenant: MAINTENANT });
    expect(signalement).toMatchObject({ statut: "TRAITE", traiteParId: "u-1", traiteAt: MAINTENANT, resolution: "Marqué traité — vu avec le partenaire" });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ entite: "EncSignalement", entiteId: "sig-1", action: "marquer_traite", motif: "vu avec le partenaire", userId: "u-1" });
  });

  it("commentaire facultatif", async () => {
    const { db, signalement } = creerDb("A_TRAITER");
    await marquerSignalementTraite(db as never, { signalementId: "sig-1", userId: "u-1", commentaire: "   ", maintenant: MAINTENANT });
    expect(signalement.resolution).toBe("Marqué traité");
  });

  it("refusé si le signalement n'est plus À TRAITER (déjà traité ou pour information), sans audit", async () => {
    for (const statut of ["TRAITE", "INFO"]) {
      const { db, signalement, audits } = creerDb(statut);
      await expect(marquerSignalementTraite(db as never, { signalementId: "sig-1", userId: "u-2", maintenant: MAINTENANT })).rejects.toThrow(EncSignalementError);
      expect(signalement.statut).toBe(statut);
      expect(audits).toHaveLength(0);
    }
  });

  it("refusé : signalement introuvable, commentaire trop long", async () => {
    const { db } = creerDb("A_TRAITER");
    await expect(marquerSignalementTraite(db as never, { signalementId: "autre", userId: "u-1", maintenant: MAINTENANT })).rejects.toThrow(/introuvable/);
    await expect(
      marquerSignalementTraite(db as never, { signalementId: "sig-1", userId: "u-1", commentaire: "x".repeat(COMMENTAIRE_TRAITEMENT_MAX + 1), maintenant: MAINTENANT })
    ).rejects.toThrow(/500/);
  });

  it("libellé de résolution", () => {
    expect(resolutionMarqueTraite(null)).toBe("Marqué traité");
    expect(resolutionMarqueTraite("ok")).toBe("Marqué traité — ok");
  });
});

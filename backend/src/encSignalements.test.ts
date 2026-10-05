import { describe, expect, it } from "vitest";

import {
  ajouterPaiementQuandMeme,
  COMMENTAIRE_TRAITEMENT_MAX,
  EncSignalementError,
  marquerSignalementTraite,
  resolutionMarqueTraite,
} from "./encSignalements";

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

// ---------------------------------------------------------------------------------------------------------------
// « Ajouter quand même » (5c)
// ---------------------------------------------------------------------------------------------------------------

function creerDbAjout(opts: { analyse?: string; statut?: string; paiementIndique?: Record<string, unknown>; existants?: Record<string, unknown>[] } = {}) {
  const signalement: Record<string, unknown> = {
    id: "sig-d",
    analyse: opts.analyse ?? "DOUBLON_POSSIBLE",
    statut: opts.statut ?? "A_TRAITER",
    contratId: "ct-1",
    brancheId: "br-1",
    importId: "imp-1",
    paiementIndique: opts.paiementIndique ?? {
      datePaiement: "2026-09-12", mode: "WAVE", reference: "T_ABC123", montant: "400.00", paiementIdFichier: "FX-0009", numeroLigne: 9,
    },
  };
  const existants = (opts.existants ?? [
    { id: "e-1", paiementId: "PAI-2026-000001", paiementIdFichier: "FX-0003", reference: "T_ZZZ999", datePaiement: new Date(Date.UTC(2026, 8, 10)), Z: "400.00", statut: "A_CONFIRMER" },
  ]) as Record<string, unknown>[];
  const encaissements: Record<string, unknown>[] = [];
  const mots: { contratId: string; mot: string }[] = [];
  const audits: Record<string, unknown>[] = [];
  const verrous: unknown[] = [];
  let seq = 1;
  const db = {
    encSignalement: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === signalement.id ? { ...signalement } : null),
      updateMany: async ({ where, data }: { where: { id: string; statut: string }; data: Record<string, unknown> }) => {
        if (where.id !== signalement.id || signalement.statut !== where.statut) return { count: 0 };
        Object.assign(signalement, data);
        return { count: 1 };
      },
    },
    encContrat: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === "ct-1" ? { numPolice: "POL-1", brancheId: "br-1", encaissements: [...existants, ...encaissements] } : null,
    },
    encEncaissement: { create: async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `e-new-${encaissements.length + 1}`, ...data }; encaissements.push(row); return row; } },
    encContratMot: { createMany: async ({ data }: { data: { contratId: string; mot: string }[] }) => (mots.push(...data), { count: data.length }) },
    encAudit: { create: async ({ data }: { data: Record<string, unknown> }) => (audits.push(data), data) },
    $executeRaw: async (...args: unknown[]) => (verrous.push(args), 0),
    $queryRaw: async () => [{ valeur: ++seq }],
  };
  return { db, signalement, encaissements, mots, audits, verrous };
}

describe("ajouterPaiementQuandMeme (5c)", () => {
  it("crée le paiement à confirmer depuis la ligne, traite le signalement, indexe la référence, audite", async () => {
    const { db, signalement, encaissements, mots, audits, verrous } = creerDbAjout();
    const r = await ajouterPaiementQuandMeme(db as never, { signalementId: "sig-d", userId: "u-1", maintenant: MAINTENANT });
    expect(r.paiementId).toBe("PAI-2026-000002");
    expect(encaissements).toHaveLength(1);
    expect(encaissements[0]).toMatchObject({
      paiementId: "PAI-2026-000002", paiementIdFichier: "FX-0009", contratId: "ct-1", brancheId: "br-1", source: "FICHIER",
      statut: "A_CONFIRMER", mode: "WAVE", reference: "T_ABC123", importId: "imp-1", importLigne: 9, saisiParId: "u-1",
    });
    expect((encaissements[0].datePaiement as Date).toISOString().slice(0, 10)).toBe("2026-09-12");
    expect(String(encaissements[0].Z)).toBe("400");
    expect(signalement).toMatchObject({ statut: "TRAITE", traiteParId: "u-1", resolution: "Ajouté quand même — PAI-2026-000002", encaissementCreeId: "e-new-1" });
    expect(mots.map((m) => m.mot)).toEqual(expect.arrayContaining(["t_abc123", "t", "abc123"]));
    expect(verrous).toHaveLength(1);
    expect(audits.map((a) => a.action)).toEqual(["ajout_quand_meme", "ajouter_quand_meme"]);
  });

  it("ancien doublon sans PaiementID du fichier ni n° de ligne : autorisé (D19)", async () => {
    const { db, encaissements } = creerDbAjout({ paiementIndique: { datePaiement: "2026-09-12", mode: "WAVE", reference: "T_ABC123", montant: "400.00" } });
    await ajouterPaiementQuandMeme(db as never, { signalementId: "sig-d", userId: "u-1", maintenant: MAINTENANT });
    expect(encaissements[0]).toMatchObject({ paiementIdFichier: null, importLigne: null });
  });

  it("refusé : pas un doublon possible, plus à traiter, paiement incomplet — rien n'est créé", async () => {
    const cas = [
      { opts: { analyse: "A_COMPLETER" }, motif: /doublons possibles/ },
      { opts: { statut: "TRAITE" }, motif: /plus à traiter/ },
      { opts: { paiementIndique: { datePaiement: "2026-09-12", mode: null, montant: "400.00" } }, motif: /incomplet/ },
    ];
    for (const { opts, motif } of cas) {
      const { db, encaissements, audits } = creerDbAjout(opts);
      await expect(ajouterPaiementQuandMeme(db as never, { signalementId: "sig-d", userId: "u-1", maintenant: MAINTENANT })).rejects.toThrow(motif);
      expect(encaissements).toHaveLength(0);
      expect(audits).toHaveLength(0);
    }
  });

  it("refusé si le même paiement est déjà enregistré (règle « déjà présent » de l'import), et au second appel", async () => {
    const { db, encaissements } = creerDbAjout({
      existants: [{ id: "e-9", paiementId: "PAI-2026-000007", paiementIdFichier: "FX-0009", reference: "AUTRE", datePaiement: new Date(Date.UTC(2026, 7, 1)), Z: "999.00", statut: "A_CONFIRMER" }],
    });
    await expect(ajouterPaiementQuandMeme(db as never, { signalementId: "sig-d", userId: "u-1", maintenant: MAINTENANT })).rejects.toThrow(/PAI-2026-000007/);
    expect(encaissements).toHaveLength(0);

    const second = creerDbAjout();
    await ajouterPaiementQuandMeme(second.db as never, { signalementId: "sig-d", userId: "u-1", maintenant: MAINTENANT });
    await expect(ajouterPaiementQuandMeme(second.db as never, { signalementId: "sig-d", userId: "u-2", maintenant: MAINTENANT })).rejects.toThrow(/plus à traiter/);
    expect(second.encaissements).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";

import { ENC_PARAMETRES } from "./encParametres";
import { controlerSaisie, saisirEncaissement, type EntreeSaisie } from "./encSaisie";

const instant = (a: number, m: number, d: number) => new Date(Date.UTC(a, m - 1, d, 10));

describe("contrôles de saisie (§8.1)", () => {
  const base = { datePaiement: "2026-10-08", mode: "CHQ", reference: "1234567", montant: "1000" };
  const maintenant = instant(2026, 10, 8);
  it("saisie complète : aucune erreur (montant à virgule accepté)", () => {
    expect(controlerSaisie(base, maintenant)).toEqual({});
    expect(controlerSaisie({ ...base, montant: "1000,50" }, maintenant)).toEqual({});
  });
  it("date, mode, référence et montant obligatoires", () => {
    const e = controlerSaisie({ datePaiement: "", mode: "", reference: "  ", montant: "" }, maintenant);
    expect(Object.keys(e).sort()).toEqual(["datePaiement", "mode", "montant", "reference"]);
  });
  it("date de paiement jamais dans le futur (le jour même accepté)", () => {
    expect(controlerSaisie({ ...base, datePaiement: "2026-10-09" }, maintenant).datePaiement).toMatch(/futur/);
    expect(controlerSaisie({ ...base, datePaiement: "2026-10-08" }, maintenant).datePaiement).toBeUndefined();
  });
  it("montant > 0", () => {
    for (const m of ["0", "-5", "abc", "10.123"]) expect(controlerSaisie({ ...base, montant: m }, maintenant).montant, m).toBeDefined();
  });
  it("Wave : T_ suivi d'au moins 10 lettres ou chiffres, sinon refusé", () => {
    const wave = (reference: string) => controlerSaisie({ ...base, mode: "WAVE", reference }, maintenant).reference;
    expect(wave("T_ABC123")).toMatch(/identifiant de transaction/);
    expect(wave("12345678901234")).toMatch(/identifiant de transaction/);
    expect(wave("T_ABCDE12345")).toBeUndefined();
    expect(wave("t_atecuquykfuixci5")).toBeUndefined();
    // Un autre mode n'a pas cette contrainte.
    expect(controlerSaisie({ ...base, mode: "OM", reference: "OM-4402" }, maintenant).reference).toBeUndefined();
  });
});

// Base simulée : un contrat, ses encaissements, la séquence PAI, l'index des mots et l'audit.
function creerBase(S = "12000", T = "11188.81", V = "811.19") {
  const encs: Record<string, unknown>[] = [];
  const mots: string[] = [];
  const audits: Record<string, unknown>[] = [];
  let sequence = 0;
  const contrat = { id: "c-1", numPolice: "POL-MENSUEL", brancheId: "b-1", S, T, U: "0", V, W: "0", X: "0", partAccessoiresPartenaire: null, partenaire: null };
  const confirmes = () => encs.filter((e) => e.statut === "CONFIRME");
  const db = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [{ valeur: ++sequence }],
    encContrat: { findUnique: async () => contrat },
    encContratMot: { createMany: async ({ data }: { data: { mot: string }[] }) => (mots.push(...data.map((d) => d.mot)), { count: data.length }) },
    encEncaissement: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        if ("reference" in where) {
          const ref = (where.reference as { equals: string }).equals.toLowerCase();
          return encs.filter((e) => String(e.reference ?? "").toLowerCase() === ref).map((e) => ({ paiementId: e.paiementId, contrat: { numPolice: "POL-AUTRE" } }));
        }
        return confirmes();
      },
      aggregate: async () => ({
        _sum: { Z: confirmes().reduce((s, e) => s + Number(e.Z), 0).toFixed(2) },
        _max: { ordrePriseEnCompte: confirmes().length ? Math.max(...confirmes().map((e) => e.ordrePriseEnCompte as number)) : null },
      }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const e = { id: `e${encs.length + 1}`, ...data };
        encs.push(e);
        return e;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const e = encs.find((x) => x.id === where.id);
        return e ? { ...e, contratId: contrat.id, contrat } : null;
      },
      updateMany: async ({ where, data }: { where: { id: string; statut: string }; data: Record<string, unknown> }) => {
        const e = encs.find((x) => x.id === where.id && x.statut === where.statut);
        if (!e) return { count: 0 };
        Object.assign(e, data);
        return { count: 1 };
      },
    },
    encParametre: { findMany: async () => ENC_PARAMETRES.map((p) => ({ cle: p.cle, valeur: p.defaut })) },
    encBeneficiaireHonoraires: { findMany: async () => [{ id: "b-nov", nom: "NOVELIA", dateDebut: new Date(Date.UTC(2000, 0, 1)) }] },
    encAudit: { create: async ({ data }: { data: Record<string, unknown> }) => (audits.push(data), data) },
  };
  return { db: db as never, encs, mots, audits };
}
const saisie = (autres: Partial<EntreeSaisie>): EntreeSaisie => ({
  contratId: "c-1",
  userId: "u-fin",
  datePaiement: "2026-07-05",
  mode: "CHQ",
  reference: "CHQ-0001",
  montant: "1000",
  maintenant: instant(2026, 7, 5),
  ...autres,
});

describe("cas 9.8 saisi à l'écran — contrat mensuel soldé en une fois", () => {
  it("trois mensualités de 1 000 puis 9 000 le 20/09 : 67,60 ×3 puis reliquat 608,39, reste dû 0", async () => {
    const { db, encs, mots } = creerBase();
    const versements: [string, string, Date][] = [
      ["2026-07-05", "1000", instant(2026, 7, 5)],
      ["2026-08-05", "1000", instant(2026, 8, 5)],
      ["2026-09-05", "1000", instant(2026, 9, 5)],
      ["2026-09-20", "9000", instant(2026, 9, 20)],
    ];
    for (const [i, [datePaiement, m, maintenant]] of versements.entries()) {
      const r = await saisirEncaissement(db, saisie({ datePaiement, montant: m, maintenant, reference: `CHQ-000${i + 1}` }));
      expect(r).toMatchObject({ statut: "CONFIRME", rang: i + 1, paiementId: `PAI-2026-00000${i + 1}` });
    }
    expect(encs.map((e) => `${e.AD} ${(e.moisExigibilite as Date).toISOString().slice(0, 7)}`)).toEqual([
      "67.60 2026-08",
      "67.60 2026-09",
      "67.60 2026-10",
      "608.39 2026-10",
    ]);
    expect(encs.map((e) => [e.source, e.statut])).toEqual(Array(4).fill(["SAISIE", "CONFIRME"]));
    expect(encs[3].AA).toBe("0.00");
    expect(mots).toContain("chq0001");
  });
});

describe("alertes à confirmer explicitement", () => {
  it("saisie invalide : erreurs par champ, rien n'est écrit", async () => {
    const { db, encs } = creerBase();
    const r = await saisirEncaissement(db, saisie({ mode: "WAVE", reference: "T_COURT" }));
    expect(r).toMatchObject({ statut: "ERREURS" });
    expect(encs).toHaveLength(0);
  });

  it("référence déjà utilisée : alerte sans écriture ; acceptée, le paiement est enregistré et l'audit le dit", async () => {
    const { db, encs, audits } = creerBase();
    await saisirEncaissement(db, saisie({ reference: "1234567" }));
    const r = await saisirEncaissement(db, saisie({ reference: "1234567", montant: "500" }));
    expect(r).toEqual({ statut: "REFERENCE_DEJA_UTILISEE", paiements: [{ paiementId: "PAI-2026-000001", numPolice: "POL-AUTRE" }] });
    expect(encs).toHaveLength(1);
    const ok = await saisirEncaissement(db, saisie({ reference: "1234567", montant: "500", accepterReferenceDejaUtilisee: true }));
    expect(ok.statut).toBe("CONFIRME");
    expect(audits.find((a) => a.action === "saisie" && a.motif)).toBeTruthy();
  });

  it("trop-perçu : alerte sans écriture (ni numéro consommé) ; accepté, confirmé avec un reste dû négatif", async () => {
    const { db, encs } = creerBase("1500", "1398.60", "101.40");
    const r = await saisirEncaissement(db, saisie({ montant: "2000" }));
    expect(r.statut === "TROP_PERCU_A_CONFIRMER" && [r.tropPercu.toFixed(2), r.restantDu.toFixed(2)]).toEqual(["500.00", "1500.00"]);
    expect(encs).toHaveLength(0);
    const ok = await saisirEncaissement(db, saisie({ montant: "2000", accepterTropPercu: true }));
    expect(ok).toMatchObject({ statut: "CONFIRME", paiementId: "PAI-2026-000001" });
    expect(encs[0]).toMatchObject({ AA: "-500.00", AD: "101.40" });
  });
});

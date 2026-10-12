import { describe, expect, it } from "vitest";

import { montant, type MontantsContrat } from "./encCalcul";
import { ENC_PARAMETRES } from "./encParametres";
import {
  calculerConfirmation,
  confirmerEncaissement,
  confirmerSuccessivement,
  EncConfirmationError,
  jourDe,
} from "./encConfirmation";

const j = (a: number, m: number, d: number) => new Date(Date.UTC(a, m - 1, d));
const mois = (d: Date) => d.toISOString().slice(0, 7);
const contrat = (S: string, T: string, U: string, V: string, W = "0", X = "0"): MontantsContrat => ({
  S: montant(S),
  T: montant(T),
  U: montant(U),
  V: montant(V),
  W: montant(W),
  X: montant(X),
});
const AUTRES = { jourLimite: 20, taux: { defaut: "0" }, beneficiaires: [{ id: "b-nov", nom: "NOVELIA", dateDebut: j(2000, 1, 1) }] };

describe("cas 9.1 — prorata sur trois encaissements", () => {
  it("AA, AB, AD, commission, honoraires et mois d'exigibilité au centime ; totaux égaux au fichier", () => {
    const r = confirmerSuccessivement(
      contrat("1500", "1398.60", "0", "101.40", "251.75", "34.97"),
      [
        { Z: "500", datePaiement: j(2026, 7, 10), datePriseEnCompte: j(2026, 7, 10) },
        { Z: "700", datePaiement: j(2026, 8, 20), datePriseEnCompte: j(2026, 8, 20) },
        { Z: "300", datePaiement: j(2026, 9, 5), datePriseEnCompte: j(2026, 9, 5) },
      ],
      AUTRES
    );
    const lignes = r.map((f) => [f.AA, f.AB, f.AD, f.commission, f.honoraires].map((m) => m.toFixed(2)).concat(mois(f.exigibilite.moisExigibilite)));
    expect(lignes).toEqual([
      ["1000.00", "466.20", "33.80", "83.92", "11.66", "2026-08"],
      ["300.00", "652.68", "47.32", "117.48", "16.32", "2026-09"],
      ["0.00", "279.72", "20.28", "50.35", "6.99", "2026-10"],
    ]);
    expect(r[2].estSoldant).toBe(true);
    expect(r.reduce((s, f) => s.plus(f.AD), montant("0")).toFixed(2)).toBe("101.40");
  });
});

describe("cas 9.4 — un chèque de 250 000 pour trois polices (taxe 7,25 % de la prime nette)", () => {
  // S = 1,0725 × T : la ventilation dépend du rapport T/S, pas du montant du contrat (aucune police n'est soldée).
  const police = contrat("1072500", "1000000", "0", "72500");
  it("AB et AD de chaque police, exigibles en octobre 2026", () => {
    const res = (["100000", "90000", "60000"] as const).map(
      (Z) => calculerConfirmation({ ...AUTRES, contrat: police, confirmes: [], datePaiement: j(2026, 9, 15), datePriseEnCompte: j(2026, 9, 15), Z }).fige
    );
    expect(res.map((f) => [f.AB.toFixed(2), f.AD.toFixed(2)])).toEqual([
      ["93240.09", "6759.91"],
      ["83916.08", "6083.92"],
      ["55944.06", "4055.94"],
    ]);
    expect(res.every((f) => mois(f.exigibilite.moisExigibilite) === "2026-10" && !f.exigibilite.estRegularisation)).toBe(true);
    expect(res.reduce((s, f) => s.plus(f.AD), montant("0")).toFixed(2)).toBe("16899.77");
  });
});

describe("cas 9.8 — contrat mensuel soldé en une fois", () => {
  it("67,60 en août, septembre, octobre puis reliquat 608,39 en octobre ; reste dû 0 ; total 811,19", () => {
    const r = confirmerSuccessivement(
      contrat("12000", "11188.81", "0", "811.19"),
      [
        { Z: "1000", datePaiement: j(2026, 7, 5), datePriseEnCompte: j(2026, 7, 5) },
        { Z: "1000", datePaiement: j(2026, 8, 5), datePriseEnCompte: j(2026, 8, 5) },
        { Z: "1000", datePaiement: j(2026, 9, 5), datePriseEnCompte: j(2026, 9, 5) },
        { Z: "9000", datePaiement: j(2026, 9, 20), datePriseEnCompte: j(2026, 9, 20) },
      ],
      AUTRES
    );
    expect(r.map((f) => `${f.AD.toFixed(2)} ${mois(f.exigibilite.moisExigibilite)}`)).toEqual([
      "67.60 2026-08",
      "67.60 2026-09",
      "67.60 2026-10",
      "608.39 2026-10",
    ]);
    expect(r[3].AA.toFixed(2)).toBe("0.00");
    expect(r.reduce((s, f) => s.plus(f.AD), montant("0")).toFixed(2)).toBe("811.19");
  });
});

describe("tableau §5.3 — exigibilité selon la prise en compte", () => {
  const cas: [Date, Date, string, string, boolean][] = [
    [j(2026, 9, 10), j(2026, 9, 12), "2026-10", "2026-10-20", false],
    [j(2026, 9, 28), j(2026, 10, 2), "2026-10", "2026-10-20", false],
    [j(2026, 9, 28), j(2026, 10, 25), "2026-11", "2026-11-20", true],
    [j(2026, 7, 15), j(2026, 9, 10), "2026-09", "2026-09-20", true],
    [j(2026, 7, 15), j(2026, 9, 20), "2026-10", "2026-10-20", true],
  ];
  it.each(cas)("payé le %s, pris en compte le %s → %s, avant le %s", (paiement, priseEnCompte, attenduMois, limite, regul) => {
    const { exigibilite } = calculerConfirmation({
      ...AUTRES,
      contrat: contrat("1500", "1398.60", "0", "101.40"),
      confirmes: [],
      datePaiement: paiement,
      datePriseEnCompte: priseEnCompte,
      Z: "500",
    }).fige;
    expect([mois(exigibilite.moisExigibilite), exigibilite.dateLimite.toISOString().slice(0, 10), exigibilite.estRegularisation]).toEqual([
      attenduMois,
      limite,
      regul,
    ]);
  });
  it("jour limite paramétré (15) : date limite le 15", () => {
    const f = calculerConfirmation({ ...AUTRES, jourLimite: 15, contrat: contrat("1500", "1398.60", "0", "101.40"), confirmes: [], datePaiement: j(2026, 9, 10), datePriseEnCompte: j(2026, 9, 12), Z: "500" }).fige;
    expect(f.exigibilite.dateLimite.toISOString().slice(0, 10)).toBe("2026-10-15");
  });
});

describe("cas 9.5 — partie calcul : payé le 12/09, pris en compte le 10/11", () => {
  it("AD 13 519,81, exigible en novembre 2026, avant le 20/11, « Régularisation »", () => {
    const { fige } = calculerConfirmation({
      ...AUTRES,
      contrat: contrat("1072500", "1000000", "0", "72500"),
      confirmes: [],
      datePaiement: j(2026, 9, 12),
      datePriseEnCompte: j(2026, 11, 10),
      Z: "200000",
    });
    expect(fige.AD.toFixed(2)).toBe("13519.81");
    expect(mois(fige.exigibilite.moisExigibilite)).toBe("2026-11");
    expect(fige.exigibilite.dateLimite.toISOString().slice(0, 10)).toBe("2026-11-20");
    expect(fige.exigibilite.estRegularisation).toBe(true);
  });
});

describe("part d'accessoires et bénéficiaire des honoraires", () => {
  const k = contrat("1600", "1400", "100", "100");
  const base = { ...AUTRES, contrat: k, confirmes: [], datePaiement: j(2026, 9, 1), datePriseEnCompte: j(2026, 9, 1), Z: "800" };
  it("9.6 : partenaire 40 % → 20 / 30 ; taux de la police 70 % prioritaire → 35 / 15 ; sinon le défaut", () => {
    const p1 = calculerConfirmation({ ...base, taux: { partenaire: "0.4", defaut: "0" } });
    expect([p1.fige.accessoires.partPartenaire.toFixed(2), p1.fige.accessoires.partSim.toFixed(2), p1.sourceTauxAccessoires]).toEqual(["20.00", "30.00", "PARTENAIRE"]);
    const p2 = calculerConfirmation({ ...base, taux: { police: "0.7", partenaire: "0.4", defaut: "0" } });
    expect([p2.fige.accessoires.partPartenaire.toFixed(2), p2.fige.accessoires.partSim.toFixed(2), p2.sourceTauxAccessoires]).toEqual(["35.00", "15.00", "POLICE"]);
    expect(calculerConfirmation({ ...base, taux: { defaut: "0.1" } }).sourceTauxAccessoires).toBe("DEFAUT");
  });
  it("bénéficiaire en vigueur à la date de PRISE EN COMPTE, pas de paiement", () => {
    const beneficiaires = [...AUTRES.beneficiaires, { id: "b-new", nom: "NOUVEAU", dateDebut: j(2026, 10, 1) }];
    const avant = calculerConfirmation({ ...base, beneficiaires, datePaiement: j(2026, 9, 25), datePriseEnCompte: j(2026, 9, 30) });
    const apres = calculerConfirmation({ ...base, beneficiaires, datePaiement: j(2026, 9, 25), datePriseEnCompte: j(2026, 10, 1) });
    expect([avant.beneficiaireHonoraires?.nom, apres.beneficiaireHonoraires?.nom]).toEqual(["NOVELIA", "NOUVEAU"]);
  });
});

// ── confirmerEncaissement, sur une base simulée (le verrou et la concurrence réelle sont vérifiés sur PostgreSQL).
type Enc = Record<string, unknown> & { id: string; statut: string; contratId: string };
function creerBase(encaissements: Enc[]) {
  const audits: Record<string, unknown>[] = [];
  const verrous: string[] = [];
  const contratA = { numPolice: "POL-A", S: "1500", T: "1398.60", U: "0", V: "101.40", W: "251.75", X: "34.97", partAccessoiresPartenaire: null, partenaire: null };
  const db = {
    $executeRaw: async (_s: TemplateStringsArray, cle: string) => (verrous.push(cle), 1),
    encEncaissement: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const e = encaissements.find((x) => x.id === where.id);
        return e ? { ...e, contrat: contratA } : null;
      },
      findMany: async ({ where }: { where: { contratId: string; statut: string } }) =>
        encaissements.filter((e) => e.contratId === where.contratId && e.statut === where.statut),
      aggregate: async ({ where }: { where: { contratId: string; statut: string } }) => ({
        _max: {
          ordrePriseEnCompte:
            encaissements
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
  return { db: db as never, audits, verrous };
}
const aConfirmer = (id: string, Z: string, datePaiement: Date, statut = "A_CONFIRMER"): Enc => ({
  id,
  paiementId: `PAI-${id}`,
  statut,
  contratId: "c-A",
  datePaiement,
  Z,
});

describe("confirmerEncaissement", () => {
  it("1er puis 2e : rang 1 puis 2, montants figés, verrou par police, audit « confirmation »", async () => {
    const encs = [aConfirmer("e1", "500", j(2026, 7, 10)), aConfirmer("e2", "700", j(2026, 8, 20))];
    const { db, audits, verrous } = creerBase(encs);
    const r1 = await confirmerEncaissement(db, { encaissementId: "e1", userId: "u-fin", maintenant: new Date(Date.UTC(2026, 6, 10, 9)) });
    const r2 = await confirmerEncaissement(db, { encaissementId: "e2", userId: "u-fin", maintenant: new Date(Date.UTC(2026, 7, 20, 9)) });
    expect([r1.statut === "CONFIRME" && r1.rang, r2.statut === "CONFIRME" && r2.rang]).toEqual([1, 2]);
    expect(encs[1]).toMatchObject({ statut: "CONFIRME", AA: "300.00", AB: "652.68", AD: "47.32", ordrePriseEnCompte: 2, confirmeParId: "u-fin" });
    expect((encs[1].datePriseEnCompte as Date).toISOString().slice(0, 10)).toBe("2026-08-20");
    expect(verrous).toEqual(["police:POL-A", "police:POL-A"]);
    expect(audits.map((a) => a.action)).toEqual(["confirmation", "confirmation"]);
  });

  it("trop-perçu : rien n'est écrit sans accord explicite ; accepté, il est confirmé et tracé", async () => {
    const encs = [aConfirmer("e1", "2000", j(2026, 9, 1))];
    const { db, audits } = creerBase(encs);
    const r = await confirmerEncaissement(db, { encaissementId: "e1", userId: "u-fin", maintenant: new Date(Date.UTC(2026, 8, 2)) });
    expect(r).toMatchObject({ statut: "TROP_PERCU_A_CONFIRMER" });
    expect(r.statut === "TROP_PERCU_A_CONFIRMER" && [r.tropPercu.toFixed(2), r.restantDu.toFixed(2)]).toEqual(["500.00", "1500.00"]);
    expect(encs[0].statut).toBe("A_CONFIRMER");
    expect(audits).toHaveLength(0);
    const ok = await confirmerEncaissement(db, { encaissementId: "e1", userId: "u-fin", maintenant: new Date(Date.UTC(2026, 8, 2)), accepterTropPercu: true });
    expect(ok.statut).toBe("CONFIRME");
    expect(encs[0]).toMatchObject({ AA: "-500.00", AD: "101.40" });
    expect(audits[0]).toMatchObject({ motif: "Trop-perçu de 500.00 FCFA confirmé explicitement" });
  });

  it("« Finalement reçu » : un « non reçu » est confirmé à SA date de prise en compte, audit dédié", async () => {
    const encs = [aConfirmer("e1", "500", j(2026, 7, 10), "NON_RECU")];
    const { db, audits } = creerBase(encs);
    const r = await confirmerEncaissement(db, { encaissementId: "e1", userId: "u-fin", maintenant: new Date(Date.UTC(2026, 9, 3, 15)) });
    expect(r.statut === "CONFIRME" && [r.rang, r.datePriseEnCompte.toISOString().slice(0, 10), mois(r.fige.exigibilite.moisExigibilite), r.fige.exigibilite.estRegularisation]).toEqual([1, "2026-10-03", "2026-10", true]);
    expect(audits[0]).toMatchObject({ action: "finalement_recu" });
  });

  it("refusé : déjà confirmé, introuvable, ou prise en compte avant le paiement", async () => {
    const encs = [aConfirmer("e1", "500", j(2026, 7, 10), "CONFIRME"), aConfirmer("e2", "500", j(2026, 9, 10))];
    const { db } = creerBase(encs);
    await expect(confirmerEncaissement(db, { encaissementId: "e1", userId: "u", maintenant: new Date() })).rejects.toThrow(EncConfirmationError);
    await expect(confirmerEncaissement(db, { encaissementId: "zz", userId: "u", maintenant: new Date() })).rejects.toThrow("Encaissement introuvable.");
    await expect(
      confirmerEncaissement(db, { encaissementId: "e2", userId: "u", maintenant: new Date(Date.UTC(2026, 8, 1)) })
    ).rejects.toThrow(/précéder la date de paiement/);
    expect(encs[1].statut).toBe("A_CONFIRMER");
  });

  it("garde-fou : prise en compte TOUJOURS le jour de l'action ; une date passée ou future est refusée", async () => {
    const encs = [aConfirmer("e1", "500", j(2026, 7, 10))];
    const { db, audits } = creerBase(encs);
    const maintenant = new Date(Date.UTC(2026, 9, 8, 14));
    for (const autre of [j(2026, 7, 10), j(2026, 10, 7), j(2026, 10, 9)]) {
      await expect(confirmerEncaissement(db, { encaissementId: "e1", userId: "u", maintenant, datePriseEnCompte: autre })).rejects.toThrow(
        /toujours la date du jour/
      );
    }
    expect([encs[0].statut, audits.length]).toEqual(["A_CONFIRMER", 0]);
    // La date du jour, indiquée ou non, est acceptée.
    const r = await confirmerEncaissement(db, { encaissementId: "e1", userId: "u", maintenant, datePriseEnCompte: j(2026, 10, 8) });
    expect(r.statut === "CONFIRME" && [r.datePriseEnCompte.toISOString().slice(0, 10), mois(r.fige.exigibilite.moisExigibilite), r.fige.exigibilite.estRegularisation]).toEqual([
      "2026-10-08",
      "2026-10",
      true,
    ]);
  });

  it("mode reprise explicite : prise en compte = date de paiement réelle, jamais de « Régularisation »", async () => {
    const encs = [aConfirmer("e1", "500", j(2026, 7, 10)), aConfirmer("e2", "700", j(2026, 8, 20))];
    const { db, audits } = creerBase(encs);
    const maintenant = new Date(Date.UTC(2026, 9, 8, 14));
    const r = await confirmerEncaissement(db, { encaissementId: "e1", userId: "u", maintenant, reprise: true });
    expect(r.statut === "CONFIRME" && [r.datePriseEnCompte.toISOString().slice(0, 10), mois(r.fige.exigibilite.moisExigibilite), r.fige.exigibilite.estRegularisation]).toEqual([
      "2026-07-10",
      "2026-08",
      false,
    ]);
    expect(audits[0]).toMatchObject({ action: "confirmation_reprise" });
    // En reprise aussi, une autre date que la date de paiement est refusée (y compris celle du jour).
    await expect(
      confirmerEncaissement(db, { encaissementId: "e2", userId: "u", maintenant, reprise: true, datePriseEnCompte: j(2026, 10, 8) })
    ).rejects.toThrow(/date de paiement réelle/);
    expect(encs[1].statut).toBe("A_CONFIRMER");
  });

  it("jourDe : la date de prise en compte est un jour, sans l'heure", () => {
    expect(jourDe(new Date(Date.UTC(2026, 9, 3, 23, 59))).toISOString()).toBe("2026-10-03T00:00:00.000Z");
  });
});

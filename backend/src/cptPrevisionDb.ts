import { Prisma, type PrismaClient } from "./generated/prisma/client";
import { promessesEnCoursAffichees } from "./cptPromessesDb";
import { assemblerPrevisionCpt, moisCpt, semainesCpt, type GranulariteCpt, type LignePrevisionCpt } from "./cptPrevision";

/**
 * Prévision d'encaissements (lot GC-7e) : LECTURE SEULE, trois requêtes groupées par jour (jamais une ligne par échéance). Mêmes sources que
 * l'état des créances : échéances de GC-3, encaissé prouvé = rattachements VALIDÉS de GC-5, promesses de GC-7d. Voir `cptPrevision.ts`.
 */
export type PrevisionDbCpt = Pick<PrismaClient, "cptEcheance" | "cptPromesse" | "cptRattachement" | "$queryRaw">;

export async function chargerPrevisionCpt(db: PrevisionDbCpt, granularite: GranulariteCpt, aujourdhui: string): Promise<LignePrevisionCpt[]> {
  const periodes = granularite === "SEMAINE" ? semainesCpt(aujourdhui) : moisCpt(aujourdhui);
  const debut = new Date(`${periodes[0].debut}T00:00:00Z`);
  const fin = new Date(`${periodes[periodes.length - 1].fin}T00:00:00Z`);

  const [echeances, encaisse, promesses] = await Promise.all([
    db.cptEcheance.groupBy({
      by: ["datePrevue"],
      where: { etat: { not: "ANNULEE" }, datePrevue: { gte: debut, lte: fin }, contrat: { statut: { not: "ANNULE" } } },
      _sum: { montantDu: true, montantRegle: true },
    }),
    db.$queryRaw<{ jour: Date; montant: Prisma.Decimal }[]>`
      SELECT e."dateValeur" AS jour, SUM(r."montant") AS montant
      FROM "CptRattachement" r JOIN "CptEncaissement" e ON e."id" = r."encaissementId"
      WHERE r."statut" = 'VALIDE' AND e."dateValeur" >= ${debut} AND e."dateValeur" <= ${fin}
      GROUP BY e."dateValeur"`,
    promessesEnCoursAffichees(db, aujourdhui, { du: periodes[0].debut, au: periodes[periodes.length - 1].fin }),
  ]);
  const jour = (d: Date) => d.toISOString().slice(0, 10);
  return assemblerPrevisionCpt(
    periodes,
    echeances.map((e) => ({ jour: jour(e.datePrevue), montantDu: (e._sum.montantDu ?? 0).toString(), montantRegle: (e._sum.montantRegle ?? 0).toString() })),
    encaisse.map((e) => ({ jour: jour(e.jour), montant: e.montant.toString() })),
    promesses.map((p) => ({ jour: jour(p.datePromise), montant: p.montant.toString() }))
  );
}

// Chargement du contrôle mensuel des relevés (Gestion Compta, lot GC-4e) : lit les totaux en base et les confie au calcul pur
// (`cptControleReleves.ts`). LECTURE SEULE. Un encaissement est rattaché à un mois par SON relevé (`CptEncaissement.releveId`), pas par
// sa date de valeur : une ligne datée du 1er avril dans le relevé de mars compte avec mars, comme dans les totaux du relevé.

import type { PrismaClient } from "./generated/prisma/client";
import { enCentimesEcheancier } from "./cptEcheancier";
import { controleMensuelReleves, type CreditsReleveMensuel, type LigneControleMensuel, type VentilationEncaissementsMensuelle } from "./cptControleReleves";

export type CptControleRelevesDb = Pick<PrismaClient, "cptReleve" | "cptEncaissement">;

const ZERO = BigInt(0);
const centimes = (d: { toString(): string } | null | undefined): bigint => (d == null ? ZERO : (enCentimesEcheancier(d.toString()) ?? ZERO));
const jourIso = (d: Date) => d.toISOString().slice(0, 10);

export async function chargerControleMensuelReleves(db: CptControleRelevesDb): Promise<LigneControleMensuel[]> {
  const releves = await db.cptReleve.findMany({ select: { id: true, compteId: true, periode: true, totalCredits: true } });
  if (releves.length === 0) return [];
  const releveParId = new Map(releves.map((r) => [r.id, { compteId: r.compteId, periode: jourIso(r.periode) }]));

  const credits: CreditsReleveMensuel[] = releves.map((r) => ({ compteId: r.compteId, periode: jourIso(r.periode), nbReleves: 1, totalCredits: centimes(r.totalCredits) }));

  const groupes = await db.cptEncaissement.groupBy({
    by: ["releveId", "typeFlux"],
    where: { releveId: { not: null }, typeFlux: { in: ["ENCAISSEMENT", "VIREMENT_INTERNE_ENTRANT"] } },
    _sum: { montant: true, resteARattacher: true, montantPasUnePrime: true },
  });
  const ventilations: VentilationEncaissementsMensuelle[] = [];
  for (const g of groupes) {
    const releve = g.releveId ? releveParId.get(g.releveId) : undefined;
    if (!releve) continue;
    ventilations.push({
      compteId: releve.compteId,
      periode: releve.periode,
      typeFlux: g.typeFlux as "ENCAISSEMENT" | "VIREMENT_INTERNE_ENTRANT",
      montant: centimes(g._sum.montant),
      resteARattacher: centimes(g._sum.resteARattacher),
      montantPasUnePrime: centimes(g._sum.montantPasUnePrime),
    });
  }
  return controleMensuelReleves(credits, ventilations);
}

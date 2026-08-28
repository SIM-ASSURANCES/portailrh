import { prisma } from "@/lib/prisma";

/**
 * Somme des règlements confirmés et non annulés d'une demande — c'est le
 * montant qui compte réellement comme "déjà réglé" (règle impérative : un
 * règlement en brouillon ou annulé ne compte jamais).
 */
export async function getTotalRegle(demandeId: string): Promise<number> {
  const result = await prisma.reglement.aggregate({
    where: { demandeId, estConfirme: true, estAnnule: false },
    _sum: { montant: true },
  });
  return Number(result._sum.montant ?? 0);
}

/**
 * Reste à régler d'une demande : montant de la demande moins le total déjà
 * réglé (confirmé, non annulé). Jamais négatif — protection défensive,
 * l'invariant "somme réglée <= montant demande" étant normalement garanti
 * à la confirmation de chaque règlement (voir `confirmerReglementAction`).
 */
export async function getResteARegler(demandeId: string): Promise<number> {
  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return 0;
  }
  const totalRegle = await getTotalRegle(demandeId);
  return Math.max(0, Number(demande.montant) - totalRegle);
}

/**
 * Solde de caisse global du portail : jamais saisi manuellement, toujours
 * recalculé à partir du grand livre immuable `JournalCaisse`
 * (entrées - sorties). N'alimente encore aucun écran dans ce ticket —
 * préparée pour le dashboard Finance d'un prochain ticket.
 */
export async function getSoldeCaisse(): Promise<number> {
  const [entrees, sorties] = await Promise.all([
    prisma.journalCaisse.aggregate({ where: { type: "ENTREE" }, _sum: { montant: true } }),
    prisma.journalCaisse.aggregate({ where: { type: "SORTIE" }, _sum: { montant: true } }),
  ]);
  return Number(entrees._sum.montant ?? 0) - Number(sorties._sum.montant ?? 0);
}

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

/**
 * Somme des `montantDepense` de TOUS les `RetourCaisse` liés aux règlements
 * d'une demande — peu importe qu'ils soient déjà réceptionnés ou non : c'est
 * ce que le collaborateur affirme avoir dépensé, indépendamment du
 * traitement de Finance. Ticket 7 (régularisation/clôture).
 */
export async function getDepensesDeclarees(demandeId: string): Promise<number> {
  const result = await prisma.retourCaisse.aggregate({
    where: { reglement: { demandeId } },
    _sum: { montantDepense: true },
  });
  return Number(result._sum.montantDepense ?? 0);
}

/**
 * Somme des `montantARetourner` des `RetourCaisse` d'une demande,
 * UNIQUEMENT ceux réceptionnés (`estReceptionne: true`) — l'argent
 * réellement revenu en caisse, par opposition à un retour simplement
 * déclaré mais pas encore traité par Finance.
 */
export async function getRetoursRecus(demandeId: string): Promise<number> {
  const result = await prisma.retourCaisse.aggregate({
    where: { reglement: { demandeId }, estReceptionne: true },
    _sum: { montantARetourner: true },
  });
  return Number(result._sum.montantARetourner ?? 0);
}

/**
 * Écart de régularisation d'une demande : montant décaissé (règlements
 * confirmés) moins ce qui est déjà justifié (dépenses déclarées + retours
 * réceptionnés). Un écart de 0 signifie que tout l'argent décaissé est
 * justifié. Un écart positif n'est pas nécessairement un blocage : c'est
 * une information affichée à Finance au moment de la clôture (la clôture
 * partielle sert justement à traiter ce cas, avec un motif obligatoire).
 */
export async function getEcart(demandeId: string): Promise<number> {
  const [totalRegle, depensesDeclarees, retoursRecus] = await Promise.all([
    getTotalRegle(demandeId),
    getDepensesDeclarees(demandeId),
    getRetoursRecus(demandeId),
  ]);
  return totalRegle - depensesDeclarees - retoursRecus;
}

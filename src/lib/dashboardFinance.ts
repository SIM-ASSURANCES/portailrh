import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Filtre partagé des retours de caisse "en attente" : non réceptionnés ET
 * dont la demande n'est pas `CLOTUREE` (une fois la demande clôturée, un
 * retour resté en attente ne peut plus jamais être réceptionné — voir
 * Ticket 7 / `receptionnerRetourAction`). Factorisé ici pour que le
 * compteur du dashboard et la liste "Retours en attente" (Ticket 6,
 * `treso/finance/retours/page.tsx`) désignent exactement le même ensemble
 * de lignes — jamais de dérive entre le chiffre affiché et ce que
 * l'utilisateur voit en cliquant dessus.
 *
 * REFONTE V1 / Phase C (voir CLAUDE.md "Refonte V1 en cours") : dépendait
 * de `STATUTS_VALIDATION_COMPLETE` (Phase B), ce qui excluait à tort les
 * retours liés à un règlement confirmé sur une demande seulement
 * `PARTIELLEMENT_VALIDEE` — le règlement (et donc son retour) est
 * désormais possible dans ce cas. Seule la clôture doit encore bloquer.
 */
export const RETOUR_EN_ATTENTE_WHERE = {
  estReceptionne: false,
  reglement: { demande: { statut: { not: "CLOTUREE" } } },
} satisfies Prisma.RetourCaisseWhereInput;

export interface CompteEtMontant {
  nombre: number;
  montant: number;
}

/**
 * Répartition des demandes ayant un montant validé (`montantValide > 0`,
 * ni `REJETEE` ni `CLOTUREE`) en deux ensembles selon leur reste à régler,
 * calculée en 2 requêtes groupées (jamais une requête par demande) : la
 * liste de ces demandes, puis la somme des règlements confirmés/non-annulés
 * groupée par `demandeId` (`groupBy`). Base commune de
 * `getDemandesADecaisser()` et `getDecaissementsARegulariser()` — le volume
 * de demandes concernées à un instant T reste modeste pour une application
 * interne, donc pas besoin d'aller plus loin qu'un `groupBy`.
 *
 * REFONTE V1 / Phase C (voir CLAUDE.md "Refonte V1 en cours") : la base de
 * sélection et de calcul du reste devient `montantValide`, PAS le statut
 * (`STATUTS_VALIDATION_COMPLETE`, Phase B) ni le montant demandé — une
 * demande `PARTIELLEMENT_VALIDEE` (cahier des charges section 4) apparaît
 * donc désormais dans "à décaisser" dès que son montant validé dépasse ce
 * qui est déjà réglé, sans attendre que le reliquat soit validé.
 */
async function getRepartitionDemandesValidees() {
  const demandes = await prisma.demande.findMany({
    where: { montantValide: { gt: 0 }, statut: { notIn: ["REJETEE", "CLOTUREE"] } },
    select: { id: true, montant: true, montantValide: true },
  });

  if (demandes.length === 0) {
    return { aDecaisser: [], aRegulariser: [] } as {
      aDecaisser: { id: string; reste: number }[];
      aRegulariser: { id: string; totalRegle: number }[];
    };
  }

  const ids = demandes.map((d) => d.id);
  const sommes = await prisma.reglement.groupBy({
    by: ["demandeId"],
    where: { demandeId: { in: ids }, estConfirme: true, estAnnule: false },
    _sum: { montant: true },
  });
  const totalRegleParDemande = new Map(sommes.map((s) => [s.demandeId, Number(s._sum.montant ?? 0)]));

  const aDecaisser: { id: string; reste: number }[] = [];
  const aRegulariser: { id: string; totalRegle: number }[] = [];
  for (const d of demandes) {
    const montantValide = Number(d.montantValide);
    const totalRegle = totalRegleParDemande.get(d.id) ?? 0;
    const reste = Math.max(0, montantValide - totalRegle);
    // "À régulariser" (candidate à la clôture) exige en plus que le montant
    // demandé soit ENTIÈREMENT validé — une demande PARTIELLEMENT_VALIDEE
    // dont la part déjà validée est intégralement réglée (reste = 0) n'est
    // volontairement dans NI l'une NI l'autre liste : rien à décaisser dans
    // l'immédiat, mais pas encore prête pour la clôture puisqu'un reliquat
    // reste à valider (et pourrait ensuite être réglé à son tour).
    const estEntierementValidee = montantValide >= Number(d.montant);
    if (reste > 0) {
      aDecaisser.push({ id: d.id, reste });
    } else if (estEntierementValidee) {
      aRegulariser.push({ id: d.id, totalRegle });
    }
  }
  return { aDecaisser, aRegulariser };
}

/**
 * Demandes ayant un montant validé dont il reste quelque chose à régler
 * (`reste > 0`, calculé sur `montantValide`). `montant` = somme des restes
 * à régler (pas le montant total des demandes) — c'est ce qu'il reste
 * réellement à décaisser.
 */
export async function getDemandesADecaisser(): Promise<CompteEtMontant> {
  const { aDecaisser } = await getRepartitionDemandesValidees();
  return {
    nombre: aDecaisser.length,
    montant: aDecaisser.reduce((sum, d) => sum + d.reste, 0),
  };
}

/**
 * Demandes ayant un montant validé entièrement décaissé (`reste === 0`,
 * calculé sur `montantValide`) mais pas encore clôturées — en attente de
 * régularisation/clôture par Finance. `montant` = somme des totaux réglés
 * de ces demandes.
 */
export async function getDecaissementsARegulariser(): Promise<CompteEtMontant> {
  const { aRegulariser } = await getRepartitionDemandesValidees();
  return {
    nombre: aRegulariser.length,
    montant: aRegulariser.reduce((sum, d) => sum + d.totalRegle, 0),
  };
}

/**
 * Nombre de retours de caisse en attente de réception — voir
 * `RETOUR_EN_ATTENTE_WHERE` ci-dessus pour la définition exacte partagée
 * avec la liste "Retours en attente".
 */
export async function getRetoursEnAttente(): Promise<{ nombre: number }> {
  const nombre = await prisma.retourCaisse.count({ where: RETOUR_EN_ATTENTE_WHERE });
  return { nombre };
}

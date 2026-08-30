import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { STATUTS_VALIDATION_COMPLETE } from "@/lib/tresorerie";

/**
 * Filtre partagé des retours de caisse "en attente" : non réceptionnés ET
 * dont la demande est toujours entièrement validée, non clôturée (une fois
 * la demande clôturée, même partiellement, un retour resté en attente ne
 * peut plus jamais être réceptionné — voir Ticket 7 /
 * `receptionnerRetourAction`). Factorisé ici pour que le compteur du
 * dashboard et la liste "Retours en attente" (Ticket 6,
 * `treso/finance/retours/page.tsx`) désignent exactement le même ensemble
 * de lignes — jamais de dérive entre le chiffre affiché et ce que
 * l'utilisateur voit en cliquant dessus.
 *
 * REFONTE V1 (Phase B) : `statut: "VALIDEE"` devient
 * `statut: { in: STATUTS_VALIDATION_COMPLETE } }` — voir
 * `STATUTS_VALIDATION_COMPLETE` dans src/lib/tresorerie.ts.
 */
export const RETOUR_EN_ATTENTE_WHERE = {
  estReceptionne: false,
  reglement: { demande: { statut: { in: [...STATUTS_VALIDATION_COMPLETE] } } },
} satisfies Prisma.RetourCaisseWhereInput;

export interface CompteEtMontant {
  nombre: number;
  montant: number;
}

/**
 * Répartition des demandes `VALIDEE` en deux ensembles selon leur reste à
 * régler, calculée en 2 requêtes groupées (jamais une requête par
 * demande) : la liste des demandes validées, puis la somme des règlements
 * confirmés/non-annulés groupée par `demandeId` (`groupBy`). Base commune
 * de `getDemandesADecaisser()` et `getDecaissementsARegulariser()` — le
 * volume de demandes validées à un instant T reste modeste pour une
 * application interne, donc pas besoin d'aller plus loin qu'un `groupBy`.
 */
async function getRepartitionDemandesValidees() {
  const demandes = await prisma.demande.findMany({
    where: { statut: { in: [...STATUTS_VALIDATION_COMPLETE] } },
    select: { id: true, montant: true },
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
    const totalRegle = totalRegleParDemande.get(d.id) ?? 0;
    const reste = Math.max(0, Number(d.montant) - totalRegle);
    if (reste > 0) {
      aDecaisser.push({ id: d.id, reste });
    } else {
      aRegulariser.push({ id: d.id, totalRegle });
    }
  }
  return { aDecaisser, aRegulariser };
}

/**
 * Demandes `VALIDEE` dont il reste quelque chose à régler (`reste > 0`).
 * `montant` = somme des restes à régler (pas le montant total des
 * demandes) — c'est ce qu'il reste réellement à décaisser.
 */
export async function getDemandesADecaisser(): Promise<CompteEtMontant> {
  const { aDecaisser } = await getRepartitionDemandesValidees();
  return {
    nombre: aDecaisser.length,
    montant: aDecaisser.reduce((sum, d) => sum + d.reste, 0),
  };
}

/**
 * Demandes `VALIDEE` entièrement décaissées (`reste === 0`) mais pas
 * encore clôturées — en attente de régularisation/clôture par Finance.
 * `montant` = somme des totaux réglés de ces demandes.
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

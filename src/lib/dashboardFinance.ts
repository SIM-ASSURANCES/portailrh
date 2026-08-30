import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getSoldesARegulariserParReglements } from "@/lib/tresorerie";

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
 * ni `REJETEE` ni `CLOTUREE`) en trois ensembles selon leur reste à régler,
 * calculée en 2 requêtes groupées (jamais une requête par demande) : la
 * liste de ces demandes, puis la somme des règlements confirmés/non-annulés
 * groupée par `demandeId` (`groupBy`). Base commune de tous les indicateurs
 * "règlement" du dashboard Finance (Phase G) — le volume de demandes
 * concernées à un instant T reste modeste pour une application interne,
 * donc pas besoin d'aller plus loin qu'un `groupBy`.
 *
 * REFONTE V1 / Phase G (voir CLAUDE.md "Refonte V1 en cours") : l'ancien
 * bucket unique "à décaisser" (Phase C, `reste > 0` sans distinction) est
 * désormais scindé en deux, conformément à la section 12 du cahier des
 * charges — la nuance "rien réglé encore" vs "déjà commencé, pas fini"
 * n'existait pas avant cette phase :
 * - `nonRegles` — validé mais AUCUN règlement encore effectué dessus
 *   (indicateur "Montants validés restant à régler").
 * - `partiels` — déjà partiellement réglé, pas terminé (indicateur
 *   "Règlements partiels à compléter").
 * - `aRegulariser` — inchangé depuis la Phase C : montant demandé
 *   ENTIÈREMENT validé ET intégralement réglé, pas encore clôturé
 *   (candidat à la clôture, Ticket 7 — ne fait PAS partie des 6 nouveaux
 *   indicateurs "À traiter" de la Phase G, resté accessible séparément,
 *   voir `treso/finance/page.tsx`).
 */
async function getRepartitionDemandesValidees() {
  const demandes = await prisma.demande.findMany({
    where: { montantValide: { gt: 0 }, statut: { notIn: ["REJETEE", "CLOTUREE"] } },
    select: { id: true, montant: true, montantValide: true },
  });

  if (demandes.length === 0) {
    return { nonRegles: [], partiels: [], aRegulariser: [] } as {
      nonRegles: { id: string; reste: number }[];
      partiels: { id: string; reste: number }[];
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

  const nonRegles: { id: string; reste: number }[] = [];
  const partiels: { id: string; reste: number }[] = [];
  const aRegulariser: { id: string; totalRegle: number }[] = [];
  for (const d of demandes) {
    const montantValide = Number(d.montantValide);
    const totalRegle = totalRegleParDemande.get(d.id) ?? 0;
    const reste = Math.max(0, montantValide - totalRegle);
    // "À régulariser" (candidate à la clôture) exige en plus que le montant
    // demandé soit ENTIÈREMENT validé — une demande PARTIELLEMENT_VALIDEE
    // dont la part déjà validée est intégralement réglée (reste = 0) n'est
    // volontairement dans AUCUN des trois buckets : rien à décaisser dans
    // l'immédiat, mais pas encore prête pour la clôture puisqu'un reliquat
    // reste à valider (et pourrait ensuite être réglé à son tour).
    const estEntierementValidee = montantValide >= Number(d.montant);
    if (reste > 0) {
      if (totalRegle === 0) {
        nonRegles.push({ id: d.id, reste });
      } else {
        partiels.push({ id: d.id, reste });
      }
    } else if (estEntierementValidee) {
      aRegulariser.push({ id: d.id, totalRegle });
    }
  }
  return { nonRegles, partiels, aRegulariser };
}

/**
 * Indicateur "À traiter" #1 — demandes en attente de validation :
 * `EN_ATTENTE_VALIDATION` (rien validé) OU `PARTIELLEMENT_VALIDEE` (un
 * reliquat non validé subsiste — elle reste donc "en attente de
 * validation" pour sa partie non validée, même si une partie a déjà été
 * validée et potentiellement réglée).
 */
export async function getDemandesEnAttenteValidation(): Promise<{ nombre: number }> {
  const nombre = await prisma.demande.count({
    where: { statut: { in: ["EN_ATTENTE_VALIDATION", "PARTIELLEMENT_VALIDEE"] } },
  });
  return { nombre };
}

/**
 * Indicateur "À traiter" #2 — montants validés restant à régler : un
 * montant a été validé (totalement ou partiellement) mais AUCUN règlement
 * n'a encore été effectué dessus (`getTotalRegle = 0`). `montant` = somme
 * des restes à régler (= montant validé, puisque rien n'est encore réglé).
 * Cible de `/treso/finance/a-decaisser`.
 */
export async function getMontantsValidesNonRegles(): Promise<CompteEtMontant> {
  const { nonRegles } = await getRepartitionDemandesValidees();
  return {
    nombre: nonRegles.length,
    montant: nonRegles.reduce((sum, d) => sum + d.reste, 0),
  };
}

/**
 * Indicateur "À traiter" #3 — règlements partiels à compléter : déjà
 * partiellement réglé (`getTotalRegle > 0`) mais pas terminé
 * (`getResteARegler > 0`). `montant` = somme des restes à régler. Cible de
 * `/treso/finance/reglements-partiels`.
 */
export async function getReglementsPartielsACompleter(): Promise<CompteEtMontant> {
  const { partiels } = await getRepartitionDemandesValidees();
  return {
    nombre: partiels.length,
    montant: partiels.reduce((sum, d) => sum + d.reste, 0),
  };
}

/**
 * Demandes ayant un montant validé ENTIÈREMENT décaissé (`reste === 0`,
 * calculé sur `montantValide`, et montant demandé intégralement validé)
 * mais pas encore clôturées — candidates à la clôture (Ticket 7). Ne fait
 * PAS partie des 6 indicateurs "À traiter" de la Phase G (non mentionné
 * par la section 12 du cahier des charges), mais reste calculée et
 * accessible séparément : la clôture d'une demande doit rester possible
 * en pratique, voir `treso/finance/a-regulariser` et le lien secondaire
 * sur `treso/finance/page.tsx`.
 */
export async function getDecaissementsARegulariser(): Promise<CompteEtMontant> {
  const { aRegulariser } = await getRepartitionDemandesValidees();
  return {
    nombre: aRegulariser.length,
    montant: aRegulariser.reduce((sum, d) => sum + d.totalRegle, 0),
  };
}

/**
 * Indicateur "À traiter" #4 — fonds remis à régulariser : règlements
 * CAISSE confirmés et non annulés dont le solde à régulariser
 * (`getSoldesARegulariserParReglements`, Phase D/G) n'est pas nul —
 * dépenses déclarées + retours reçus ne couvrent pas encore (ou dépassent)
 * le montant réglé. `montant` = somme de ces soldes (peut inclure des
 * valeurs positives comme négatives, additionnées telles quelles — un
 * solde négatif signalerait un sur-retour, cas limite non exclu par la
 * définition du cahier des charges qui demande juste `!== 0`). Cible de
 * `/treso/finance/fonds-a-regulariser`.
 */
export async function getFondsRemisARegulariser(): Promise<CompteEtMontant> {
  const reglements = await prisma.reglement.findMany({
    where: { mode: "CAISSE", estConfirme: true, estAnnule: false },
    select: { id: true },
  });
  const soldes = await getSoldesARegulariserParReglements(reglements.map((r) => r.id));

  let nombre = 0;
  let montant = 0;
  for (const solde of soldes.values()) {
    if (solde !== 0) {
      nombre += 1;
      montant += solde;
    }
  }
  return { nombre, montant };
}

/**
 * Indicateur "À traiter" #5 — retours de fonds en attente de réception :
 * reprend `RETOUR_EN_ATTENTE_WHERE` (Ticket 6/8), inchangé. Cible de
 * `/treso/finance/retours`.
 */
export async function getRetoursEnAttenteReception(): Promise<{ nombre: number }> {
  const nombre = await prisma.retourCaisse.count({ where: RETOUR_EN_ATTENTE_WHERE });
  return { nombre };
}

/**
 * Indicateur "À traiter" #6 — dépenses non justifiées à suivre :
 * `DepenseLigne` dont la justification est `SANS_PIECE`, dont le
 * règlement lié n'est pas encore totalement régularisé (son solde à
 * régulariser, `getSoldesARegulariserParReglements`, est différent de 0) —
 * une fois le règlement intégralement justifié/retourné, une ligne non
 * justifiée qu'il contenait n'est plus "à suivre" activement (l'écart
 * global est soldé). `nombre` = nombre de lignes, `montant` = somme de
 * leurs montants. Cible de `/treso/finance/depenses-non-justifiees`.
 */
export async function getDepensesNonJustifiees(): Promise<CompteEtMontant> {
  const lignes = await prisma.depenseLigne.findMany({
    where: { justification: "SANS_PIECE" },
    select: { id: true, montant: true, retourCaisse: { select: { reglementId: true } } },
  });
  if (lignes.length === 0) {
    return { nombre: 0, montant: 0 };
  }

  const reglementIds = Array.from(new Set(lignes.map((l) => l.retourCaisse.reglementId)));
  const soldes = await getSoldesARegulariserParReglements(reglementIds);

  let nombre = 0;
  let montant = 0;
  for (const ligne of lignes) {
    const solde = soldes.get(ligne.retourCaisse.reglementId) ?? 0;
    if (solde !== 0) {
      nombre += 1;
      montant += Number(ligne.montant);
    }
  }
  return { nombre, montant };
}

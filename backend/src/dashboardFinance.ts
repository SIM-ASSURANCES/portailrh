import type { ModeReglement, Prisma } from "./generated/prisma/client";
import { prisma } from "./prisma";
import {
  DEMANDES_EN_ATTENTE_VALIDATION_WHERE,
  getMontantConsommeCategorie,
  getSoldesARegulariserParReglements,
} from "./tresorerie";

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
 * validée et potentiellement réglée). Voir
 * `DEMANDES_EN_ATTENTE_VALIDATION_WHERE` (`tresorerie.ts`) pour l'exclusion
 * `reliquatRejete: false` (bug corrigé : un reliquat explicitement rejeté
 * n'est plus "à traiter", même si `statut` reste `PARTIELLEMENT_VALIDEE`).
 * Cette même fonction alimente aussi la feuille "Dashboard" de l'export
 * Excel (`reporting.ts`) — un seul point de calcul, jamais deux.
 */
export async function getDemandesEnAttenteValidation(): Promise<{ nombre: number }> {
  const nombre = await prisma.demande.count({
    where: DEMANDES_EN_ATTENTE_VALIDATION_WHERE,
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
/**
 * Indicateur "Validation complète (DG)" — demandes ayant un montant validé
 * (`montantValide > 0`) mais pas encore approuvées par le DG
 * (`validationCompleteParDG = false`), préalable obligatoire à la clôture
 * depuis le "Verrou de clôture" (Ticket 7, voir CLAUDE.md). Filtre minimal
 * mais suffisant : `montantValide > 0` exclut déjà mécaniquement
 * `EN_ATTENTE_VALIDATION` et `REJETEE` (jamais de montant validé sur ces
 * deux statuts) ; `validationCompleteParDG = false` exclut déjà `CLOTUREE`
 * (la clôture exige cette approbation au préalable — impossible d'atteindre
 * `CLOTUREE` avec `validationCompleteParDG` encore à `false`). Aucun besoin
 * d'exclusion de statut explicite en plus.
 *
 * **Signalé et corrigé ici** : cet indicateur n'existait pas depuis la
 * construction initiale du verrou de clôture — aucune liste ni compteur ne
 * permettait au DG de découvrir quelles demandes attendent son approbation,
 * seul un accès direct par identifiant de demande fonctionnait. Voir
 * CLAUDE.md "Découverte des validations complètes en attente (DG)".
 *
 * Réservé au DG (`treso.approuver_validation_complete`, distincte de
 * `treso.voir_dashboard_finance` qui garde le reste du dashboard) — la
 * page appelante revérifie cette permission, jamais supposée acquise du
 * simple fait d'avoir accès au dashboard Finance.
 */
export async function getValidationsCompletesEnAttente(): Promise<{ nombre: number }> {
  const nombre = await prisma.demande.count({
    where: { montantValide: { gt: 0 }, validationCompleteParDG: false },
  });
  return { nombre };
}

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

// ============================================================
// Refonte visuelle du dashboard Finance — graphiques (voir CLAUDE.md
// "Refonte visuelle du dashboard Finance"). Aucune nouvelle règle
// métier : ces fonctions ne font que RESTITUER, sous une forme adaptée à
// un graphique, des écritures déjà régies par les règles existantes
// (`JournalCaisse`, `Reglement`, `Categorie.budgetAlloue`).
// ============================================================

export interface PointEvolutionSoldeCaisse {
  date: Date;
  solde: number;
}

export interface EvolutionSoldeCaisse {
  points: PointEvolutionSoldeCaisse[];
  /** Début réel de la fenêtre retenue (voir `getEvolutionSoldeCaisse`) —
   * exposé pour que l'appelant puisse aligner un autre graphique
   * (répartition des règlements) sur EXACTEMENT la même période, sans
   * jamais recalculer une date de départ indépendante. */
  depuis: Date;
}

/**
 * Évolution chronologique du solde de caisse — point de départ : le
 * solde déjà en vigueur `joursMax` jours avant aujourd'hui (ou dès la
 * toute première écriture du grand livre si celui-ci est plus jeune que
 * `joursMax` jours, cas courant sur un compte de test) ; puis un point
 * par écriture `JournalCaisse` RÉELLE dans cette fenêtre, cumulée dans
 * l'ORDRE CHRONOLOGIQUE D'ENREGISTREMENT (`createdAt`, jamais
 * `dateOperation` — c'est l'ordre d'écriture qui a réellement fait varier
 * le solde à chaque instant, `dateOperation` n'étant qu'une étiquette
 * d'affichage pour l'alimentation de caisse, voir CLAUDE.md "Nouvelle
 * alimentation de caisse"). Même formule que `getSoldeCaisse()` (ENTREE −
 * SORTIE), jamais un calcul parallèle : le dernier point de la série est
 * toujours strictement égal à `getSoldeCaisse()`.
 *
 * Deux requêtes seulement (jamais une par jour ni par écriture) : un
 * agrégat ENTREE/SORTIE pour tout ce qui précède la fenêtre (le solde de
 * départ), puis la liste des écritures DANS la fenêtre à cumuler une à
 * une en mémoire — volume borné par l'activité réelle de caisse, jamais
 * de pagination nécessaire pour une trésorerie d'entreprise interne.
 *
 * Retourne un tableau vide si le grand livre est entièrement vide (aucun
 * mouvement n'a jamais existé) — à l'écran, ce cas se distingue de "un
 * seul point, rien à tracer dans la fenêtre" (longueur 1) : les deux
 * doivent être traités comme un état vide par l'appelant (pas de courbe
 * significative avec moins de 2 points).
 */
export async function getEvolutionSoldeCaisse(joursMax = 30): Promise<EvolutionSoldeCaisse> {
  const limiteParDefaut = new Date(Date.now() - joursMax * 24 * 60 * 60 * 1000);

  const premiereEcriture = await prisma.journalCaisse.findFirst({
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  if (!premiereEcriture) {
    return { points: [], depuis: limiteParDefaut };
  }

  const dateDebut = premiereEcriture.createdAt > limiteParDefaut ? premiereEcriture.createdAt : limiteParDefaut;

  const [entreesAvant, sortiesAvant, ecrituresPeriode] = await Promise.all([
    prisma.journalCaisse.aggregate({
      where: { type: "ENTREE", createdAt: { lt: dateDebut } },
      _sum: { montant: true },
    }),
    prisma.journalCaisse.aggregate({
      where: { type: "SORTIE", createdAt: { lt: dateDebut } },
      _sum: { montant: true },
    }),
    prisma.journalCaisse.findMany({
      where: { createdAt: { gte: dateDebut } },
      orderBy: { createdAt: "asc" },
      select: { type: true, montant: true, createdAt: true },
    }),
  ]);

  const soldeDepart = Number(entreesAvant._sum.montant ?? 0) - Number(sortiesAvant._sum.montant ?? 0);
  const points: PointEvolutionSoldeCaisse[] = [{ date: dateDebut, solde: soldeDepart }];
  ecrituresPeriode.reduce((solde, e) => {
    const nouveauSolde = solde + (e.type === "ENTREE" ? Number(e.montant) : -Number(e.montant));
    points.push({ date: e.createdAt, solde: nouveauSolde });
    return nouveauSolde;
  }, soldeDepart);

  return { points, depuis: dateDebut };
}

export interface RepartitionModeReglement {
  mode: ModeReglement;
  montant: number;
  nombre: number;
}

/**
 * Répartition des règlements confirmés (non annulés) par mode de
 * paiement, depuis une date donnée — pensé pour partager EXACTEMENT la
 * même fenêtre que `getEvolutionSoldeCaisse` (même `dateDebut` transmise
 * par la page appelante), pour que le donut Caisse/Banque et la courbe de
 * solde décrivent la même période à l'écran. Filtré sur `confirmeAt`
 * (date d'effet réelle du règlement, pas `createdAt` qui daterait un
 * brouillon éventuel) — cohérent avec les écritures `JournalCaisse`
 * correspondantes, créées au moment précis de la confirmation.
 */
export async function getRepartitionReglementsParMode(depuis: Date): Promise<RepartitionModeReglement[]> {
  const groupes = await prisma.reglement.groupBy({
    by: ["mode"],
    where: { estConfirme: true, estAnnule: false, confirmeAt: { gte: depuis } },
    _sum: { montant: true },
    _count: { _all: true },
  });
  return groupes.map((g) => ({
    mode: g.mode,
    montant: Number(g._sum.montant ?? 0),
    nombre: g._count._all,
  }));
}

export interface CategorieBudgetSuivi {
  id: string;
  label: string;
  budgetAlloue: number;
  consomme: number;
  restant: number;
}

/**
 * Catégories actives ayant un budget alloué, triées par montant consommé
 * décroissant et limitées à `limite` (dashboard : top 5, écran ne doit
 * pas être surchargé si l'Admin a défini un budget sur de nombreuses
 * catégories) — réutilise `getMontantConsommeCategorie` (une fois par
 * catégorie concernée, jamais une deuxième formule de calcul), la même
 * fonction que le contrôle bloquant du règlement et l'aperçu de
 * catégorisation (voir CLAUDE.md "Budget partagé par Catégorie" et
 * "Budget visible au moment de la catégorisation").
 */
export async function getTopCategoriesBudget(limite = 5): Promise<CategorieBudgetSuivi[]> {
  const categories = await prisma.categorie.findMany({
    where: { budgetAlloue: { not: null }, isActive: true },
    select: { id: true, label: true, budgetAlloue: true },
  });
  if (categories.length === 0) {
    return [];
  }

  const consommations = await Promise.all(categories.map((c) => getMontantConsommeCategorie(c.id)));

  return categories
    .map((c, i) => {
      const budgetAlloue = Number(c.budgetAlloue);
      const consomme = consommations[i];
      return { id: c.id, label: c.label, budgetAlloue, consomme, restant: budgetAlloue - consomme };
    })
    .sort((a, b) => b.consomme - a.consomme)
    .slice(0, limite);
}

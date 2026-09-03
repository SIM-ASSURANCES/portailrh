import type { StatutDemande } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Statuts d'une Demande dont le montant est ENTIÈREMENT validé (montantValide
 * === montant demandé), quel que soit l'avancement du règlement — c'est
 * l'ensemble qui, avant la Phase B (validation partielle), tenait entièrement
 * dans l'unique statut `VALIDEE`.
 *
 * REFONTE V1 / Phase C (voir CLAUDE.md "Refonte V1 en cours") : **n'est plus
 * utilisé pour l'éligibilité au règlement ni au retour de caisse** — voir
 * `peutEffectuerReglement` ci-dessous, qui autorise aussi une demande
 * seulement `PARTIELLEMENT_VALIDEE` (cahier des charges section 4). Reste
 * utilisé pour l'éligibilité à la CLÔTURE (`cloturerDemandeAction`, Ticket
 * 7) et la colonne "Validé" du reporting (Ticket 10), hors périmètre de la
 * Phase C.
 */
export const STATUTS_VALIDATION_COMPLETE: readonly StatutDemande[] = [
  "VALIDEE",
  "VALIDEE_NON_REGLEE",
  "PARTIELLEMENT_REGLEE",
  "REGLEE",
];

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
 * Reste à régler d'une demande : `montantValide` moins le total déjà réglé
 * (confirmé, non annulé). Jamais négatif — protection défensive, l'invariant
 * "somme réglée <= montantValide" étant normalement garanti à la
 * confirmation de chaque règlement (voir `confirmerReglementAction`).
 *
 * REFONTE V1 / Phase C (voir CLAUDE.md "Refonte V1 en cours") : la base de
 * calcul est `montantValide`, **PAS** le montant demandé — cahier des
 * charges section 4 : "Montant validé : 250 000 FCFA. Premier règlement :
 * 200 000 FCFA. Solde validé restant à régler : 50 000 FCFA." Une demande
 * `PARTIELLEMENT_VALIDEE` (250 000 validés sur 400 000 demandés) est donc
 * réglable immédiatement sur la base des 250 000 déjà validés, sans
 * attendre la validation complémentaire du reliquat. Si `montantValide` est
 * encore `null` (aucune validation), retourne 0 : rien n'est réglable.
 */
export async function getResteARegler(demandeId: string): Promise<number> {
  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande || demande.montantValide == null) {
    return 0;
  }
  const totalRegle = await getTotalRegle(demandeId);
  return Math.max(0, Number(demande.montantValide) - totalRegle);
}

/**
 * Éligibilité d'une demande au règlement (Phase C) : `montantValide > 0`
 * ET `getResteARegler(demandeId) > 0`, plus deux verrous terminaux
 * explicites (`REJETEE`/`CLOTUREE`) que le seul calcul sur les montants ne
 * suffit pas à couvrir — une demande clôturée avec un écart non résolu
 * (clôture partielle, Ticket 7) peut avoir un reste > 0 sans qu'aucune
 * action de règlement ne doive redevenir possible dessus.
 *
 * Remplace `STATUTS_VALIDATION_COMPLETE` pour cette logique précise : cet
 * ensemble figé (VALIDEE/VALIDEE_NON_REGLEE/PARTIELLEMENT_REGLEE/REGLEE)
 * excluait à tort `PARTIELLEMENT_VALIDEE`, alors que le cahier des charges
 * (section 4) autorise explicitement le règlement d'une demande seulement
 * partiellement validée. `STATUTS_VALIDATION_COMPLETE` reste néanmoins
 * utilisée ailleurs (ex: éligibilité à la clôture, Ticket 7 — hors
 * périmètre de cette phase).
 */
export async function peutEffectuerReglement(demandeId: string): Promise<boolean> {
  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return false;
  }
  if (demande.statut === "CLOTUREE" || demande.statut === "REJETEE") {
    return false;
  }
  if (demande.montantValide == null || Number(demande.montantValide) <= 0) {
    return false;
  }
  return (await getResteARegler(demandeId)) > 0;
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
 * Somme des `DepenseLigne` de TOUS les `RetourCaisse` liés aux règlements
 * d'une demande — peu importe qu'ils soient déjà réceptionnés ou non : c'est
 * ce que le collaborateur affirme avoir dépensé, indépendamment du
 * traitement de Finance. Ticket 7 (régularisation/clôture).
 *
 * REFONTE V1 / Phase D (voir CLAUDE.md "Refonte V1 en cours") : un
 * `RetourCaisse` n'a plus de `montantDepense` agrégé unique — remplacé par
 * ses lignes de dépenses détaillées (`DepenseLigne`), sommées ici via la
 * relation imbriquée `retourCaisse.reglement.demandeId`.
 */
export async function getDepensesDeclarees(demandeId: string): Promise<number> {
  const result = await prisma.depenseLigne.aggregate({
    where: { retourCaisse: { reglement: { demandeId } } },
    _sum: { montant: true },
  });
  return Number(result._sum.montant ?? 0);
}

/**
 * Somme des montants de TOUTES les `DepenseLigne` d'un `RetourCaisse`
 * précis — c'est le total qui sert à calculer `montantARetourner`
 * (`getMontantARetourner` ci-dessous). Phase D (fonds remis, cahier des
 * charges sections 8-9).
 */
export async function getTotalDepensesDeclarees(retourCaisseId: string): Promise<number> {
  const result = await prisma.depenseLigne.aggregate({
    where: { retourCaisseId },
    _sum: { montant: true },
  });
  return Number(result._sum.montant ?? 0);
}

/**
 * Somme des montants des `DepenseLigne` d'un `RetourCaisse` dont la
 * justification est `SANS_PIECE` — la part de la dépense déclarée qui
 * n'est appuyée par aucun justificatif formel, mise en évidence à
 * l'affichage (Tâche 5).
 */
export async function getMontantNonJustifie(retourCaisseId: string): Promise<number> {
  const result = await prisma.depenseLigne.aggregate({
    where: { retourCaisseId, justification: "SANS_PIECE" },
    _sum: { montant: true },
  });
  return Number(result._sum.montant ?? 0);
}

/**
 * Montant à retourner d'un `RetourCaisse` : montant du règlement lié moins
 * le total de ses `DepenseLigne` déclarées, jamais négatif. **Toujours
 * calculé, jamais saisi manuellement** — voir le commentaire de
 * `RetourCaisse.montantARetourner` dans `schema.prisma` et CLAUDE.md
 * "Refonte V1 en cours" / Phase D pour la justification de ce choix
 * (tension cahier des charges section 9.3 vs 9.5, tranchée en faveur du
 * calcul automatique, cohérent avec `getSoldeCaisse`).
 */
export async function getMontantARetourner(retourCaisseId: string): Promise<number> {
  const retour = await prisma.retourCaisse.findUnique({
    where: { id: retourCaisseId },
    include: { reglement: true },
  });
  if (!retour) {
    return 0;
  }
  const totalDepenses = await getTotalDepensesDeclarees(retourCaisseId);
  return Math.max(0, Number(retour.reglement.montant) - totalDepenses);
}

/**
 * Solde à régulariser d'un règlement précis : montant du règlement moins
 * les dépenses déclarées (toutes les `DepenseLigne` de TOUS les
 * `RetourCaisse` liés à ce règlement) moins les retours effectivement
 * reçus (`montantARetourner` des retours `estReceptionne: true` liés à ce
 * règlement). **Doit valoir 0 une fois que tout est correctement justifié
 * et/ou retourné** — un solde non nul signale un écart (dépense non
 * couverte par une ligne déclarée, ou retour déclaré mais pas encore
 * réceptionné). Phase D (fonds remis, cahier des charges sections 8-9) —
 * équivalent de `getEcart` (Ticket 7) mais à l'échelle d'un règlement
 * précis plutôt que d'une demande entière (une demande peut avoir
 * plusieurs règlements Caisse, chacun avec son propre cycle fonds remis).
 */
export async function getSoldeARegulariser(reglementId: string): Promise<number> {
  const soldes = await getSoldesARegulariserParReglements([reglementId]);
  return soldes.get(reglementId) ?? 0;
}

/**
 * Variante en masse de `getSoldeARegulariser`, pour plusieurs règlements à
 * la fois SANS requête par règlement (Phase G, dashboard Finance — indicateurs
 * "Fonds remis à régulariser" et "Dépenses non justifiées à suivre") : une
 * seule requête `DepenseLigne`/`RetourCaisse` pour l'ensemble des règlements
 * demandés, réduite en mémoire (volume modeste, même convention que le
 * reste du reporting/dashboard). `getSoldeARegulariser` ci-dessus n'est
 * plus qu'un appel à celle-ci avec un seul id — jamais deux implémentations
 * de la même formule.
 */
export async function getSoldesARegulariserParReglements(
  reglementIds: string[]
): Promise<Map<string, number>> {
  if (reglementIds.length === 0) {
    return new Map();
  }

  const reglements = await prisma.reglement.findMany({
    where: { id: { in: reglementIds } },
    select: { id: true, montant: true },
  });

  const retours = await prisma.retourCaisse.findMany({
    where: { reglementId: { in: reglementIds } },
    select: {
      reglementId: true,
      estReceptionne: true,
      montantARetourner: true,
      depenses: { select: { montant: true } },
    },
  });

  const soldes = new Map<string, number>();
  for (const r of reglements) {
    soldes.set(r.id, Number(r.montant));
  }
  for (const retour of retours) {
    const depensesDeclarees = retour.depenses.reduce((sum, d) => sum + Number(d.montant), 0);
    const retourRecu = retour.estReceptionne ? Number(retour.montantARetourner) : 0;
    const courant = soldes.get(retour.reglementId) ?? 0;
    soldes.set(retour.reglementId, courant - depensesDeclarees - retourRecu);
  }
  return soldes;
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

/**
 * Consommation réelle du budget PARTAGÉ d'une Catégorie (voir CLAUDE.md
 * "Budget partagé par Catégorie") : somme des règlements confirmés et non
 * annulés de TOUTES les demandes ayant cette `categorieId`, tous
 * demandeurs et tous bénéficiaires confondus — un Commercial qui achète un
 * ordinateur et un Marketing qui achète une imprimante, catégorisés tous
 * les deux "Informatique", puisent dans la même enveloppe. Décomptée au
 * RÈGLEMENT (pas à la validation) : c'est le moment où l'argent sort
 * réellement (règle impérative du module, voir CLAUDE.md).
 *
 * Équivalent mathématique de "appliquer `getTotalRegle` à chaque demande de
 * cette catégorie et sommer", mais en une seule requête `aggregate` avec un
 * filtre de relation (`demande: { categorieId }`) plutôt qu'une boucle —
 * jamais une requête par demande.
 */
export async function getMontantConsommeCategorie(categorieId: string): Promise<number> {
  const result = await prisma.reglement.aggregate({
    where: { estConfirme: true, estAnnule: false, demande: { categorieId } },
    _sum: { montant: true },
  });
  return Number(result._sum.montant ?? 0);
}

/**
 * Budget restant d'une Catégorie : `null` si `budgetAlloue` est `null`
 * (aucune limite définie, aucun contrôle appliqué) ; sinon `budgetAlloue -
 * getMontantConsommeCategorie(categorieId)`. **Retourne la valeur BRUTE,
 * jamais plafonnée à 0** — un résultat négatif signale un dépassement réel
 * (utile à `confirmerReglementAction` et au reporting "Suivi budgétaire"
 * pour le détecter) ; c'est à l'affichage de choisir, au cas par cas, de
 * clamper avec `Math.max(0, ...)` ou de montrer le dépassement tel quel.
 */
export async function getBudgetRestantCategorie(categorieId: string): Promise<number | null> {
  const categorie = await prisma.categorie.findUnique({
    where: { id: categorieId },
    select: { budgetAlloue: true },
  });
  if (!categorie || categorie.budgetAlloue == null) {
    return null;
  }
  const consomme = await getMontantConsommeCategorie(categorieId);
  return Number(categorie.budgetAlloue) - consomme;
}

export interface MesIndicateurs {
  /** Somme des montants de TOUTES les demandes créées par cet utilisateur, quel que soit leur statut. */
  demande: number;
  /** Somme de `Demande.montantValide` (0/null compte pour 0) sur ces mêmes demandes. */
  valide: number;
  /** `max(0, demande - valide)`. */
  restantAValider: number;
  /** Somme des règlements confirmés et non annulés (Caisse + Banque) de ces demandes. */
  regle: number;
  /** `max(0, valide - regle)`. */
  valideRestantARegler: number;
}

/**
 * Synthèse personnelle d'un Collaborateur pour "Mon tableau de bord"
 * (cahier des charges section 14) — les 5 mêmes indicateurs que la vision
 * synthétique générale, scopés à un seul utilisateur au lieu de toute
 * l'organisation. Formules strictement identiques à `getReportingRows`
 * (Phase H, `src/lib/reporting.ts`), juste agrégées en un seul total plutôt
 * que groupées par Catégorie/Objet — jamais une deuxième définition de ces
 * mêmes calculs.
 *
 * **Scope choisi : `createurId`, jamais `beneficiaireUserId`.** Deux
 * raisons : (1) c'est déjà le filtre de "Mes demandes"
 * (`treso/demandes/page.tsx`, Ticket 1) — un tableau de bord personnel qui
 * compterait différemment de la liste juste en dessous serait incohérent
 * pour l'utilisateur ; (2) `beneficiaireUserId` n'est renseigné que pour un
 * bénéficiaire `COLLABORATEUR`/`STAGIAIRE` (Phase A) — une demande dont le
 * créateur est bénéficiaire `ENTREPRISE`/`FOURNISSEUR` (cas normal, pas
 * seulement les dépenses directes de Finance) aurait disparu du tableau de
 * bord de son propre créateur. Cohérent avec le principe directeur : le
 * cycle démarre de la demande du Collaborateur, qui en est l'auteur, pas
 * nécessairement le bénéficiaire final.
 *
 * Calculée en 2 requêtes (jamais une par demande) : la liste des demandes
 * de l'utilisateur, puis un `groupBy` des règlements confirmés/non-annulés
 * sur ces mêmes demandes — même pattern que `getRepartitionDemandesValidees`
 * (`dashboardFinance.ts`) et `getReportingRows`.
 */
export async function getMesIndicateurs(userId: string): Promise<MesIndicateurs> {
  const demandes = await prisma.demande.findMany({
    where: { createurId: userId },
    select: { id: true, montant: true, montantValide: true },
  });

  if (demandes.length === 0) {
    return { demande: 0, valide: 0, restantAValider: 0, regle: 0, valideRestantARegler: 0 };
  }

  const ids = demandes.map((d) => d.id);
  const sommes = await prisma.reglement.groupBy({
    by: ["demandeId"],
    where: { demandeId: { in: ids }, estConfirme: true, estAnnule: false },
    _sum: { montant: true },
  });
  const regleParDemande = new Map(sommes.map((s) => [s.demandeId, Number(s._sum.montant ?? 0)]));

  let demande = 0;
  let valide = 0;
  let regle = 0;
  for (const d of demandes) {
    demande += Number(d.montant);
    valide += Number(d.montantValide ?? 0);
    regle += regleParDemande.get(d.id) ?? 0;
  }

  return {
    demande,
    valide,
    restantAValider: Math.max(0, demande - valide),
    regle,
    valideRestantARegler: Math.max(0, valide - regle),
  };
}

/**
 * Zone "À traiter" personnelle, indicateur #1 — nombre de demandes créées
 * par l'utilisateur encore en attente d'une décision de validation
 * (`EN_ATTENTE_VALIDATION` : rien validé, ou `PARTIELLEMENT_VALIDEE` : un
 * reliquat non validé subsiste). Même définition que
 * `getDemandesEnAttenteValidation` (`dashboardFinance.ts`), scopée par
 * `createurId`.
 */
export async function getMesDemandesEnAttente(userId: string): Promise<{ nombre: number }> {
  const nombre = await prisma.demande.count({
    where: { createurId: userId, statut: { in: ["EN_ATTENTE_VALIDATION", "PARTIELLEMENT_VALIDEE"] } },
  });
  return { nombre };
}

/**
 * Règlements Caisse confirmés (non annulés) des demandes créées par cet
 * utilisateur, pour lesquels **aucun** `RetourCaisse` n'a encore été
 * déclaré — même règle d'éligibilité que le bouton "Déclarer un retour de
 * caisse" (Ticket 5, `RetoursCaisseSection.tsx` : un seul retour par
 * règlement) : `mode: CAISSE`, `estConfirme: true`, `estAnnule: false`,
 * aucune ligne dans `retours`. Exclut aussi les demandes déjà `CLOTUREE`
 * (Ticket 7 : un retour resté en attente sur une demande clôturée ne peut
 * plus jamais être déclaré — même verrou que `peutDeclarer` sur cet écran).
 *
 * Retourne la liste complète (pas seulement un compte) : c'est elle qui
 * détermine, à l'écran, si le clic sur la carte "Mes retours de caisse à
 * déclarer" doit mener directement à l'unique demande concernée ou à
 * l'écran de liste `retours-a-declarer` (plusieurs règlements en attente).
 * `getMesRetoursADeclarer` ci-dessous n'est qu'un `{ nombre }` dérivé de
 * cette même requête — jamais deux implémentations de la même règle.
 */
export async function getReglementsCaisseADeclarer(userId: string): Promise<
  { reglementId: string; demandeId: string; reference: string; montant: number; confirmeAt: Date | null }[]
> {
  const reglements = await prisma.reglement.findMany({
    where: {
      mode: "CAISSE",
      estConfirme: true,
      estAnnule: false,
      demande: { createurId: userId, statut: { not: "CLOTUREE" } },
      retours: { none: {} },
    },
    select: {
      id: true,
      montant: true,
      confirmeAt: true,
      demande: { select: { id: true, reference: true } },
    },
    orderBy: { confirmeAt: "asc" },
  });

  return reglements.map((r) => ({
    reglementId: r.id,
    demandeId: r.demande.id,
    reference: r.demande.reference,
    montant: Number(r.montant),
    confirmeAt: r.confirmeAt,
  }));
}

/**
 * Zone "À traiter" personnelle, indicateur #2 — nombre de règlements Caisse
 * en attente de déclaration d'un retour (voir `getReglementsCaisseADeclarer`
 * pour la règle d'éligibilité complète). C'est une action qui revient au
 * Collaborateur lui-même, jamais à Finance.
 */
export async function getMesRetoursADeclarer(userId: string): Promise<{ nombre: number }> {
  const reglements = await getReglementsCaisseADeclarer(userId);
  return { nombre: reglements.length };
}

/** Convertit un montant en centimes entiers pour des comparaisons fiables
 * (évite les artefacts de virgule flottante sur des `Number(Prisma.Decimal)`
 * lors d'une égalité stricte, ex: montantValide === montant demandé). */
function toCents(montant: number): number {
  return Math.round(montant * 100);
}

/**
 * Calcule le statut d'une Demande à partir de ses montants réels (montant
 * demandé, `montantValide`, total réglé — `getTotalRegle`) et l'enregistre
 * en base. Fonction centrale de la Phase B (validation partielle) : à
 * appeler à la fin de CHAQUE action qui modifie `montantValide` ou les
 * règlements d'une demande (validation initiale/complémentaire, et plus
 * tard règlement/clôture dans les phases suivantes), plutôt que de fixer
 * `statut` à la main à chaque endroit.
 *
 * Interprétation retenue (le cahier des charges laisse une marge sur
 * l'articulation exacte de ces statuts — voir CLAUDE.md "Refonte V1 en
 * cours" / Phase B pour la discussion complète) :
 *
 * - `REJETEE` et `CLOTUREE` sont des états TERMINAUX, gérés par leurs
 *   propres actions dédiées (`rejeterDemandeAction`,
 *   `cloturerDemandeAction`) : cette fonction ne les modifie jamais,
 *   même si les montants changeraient techniquement le calcul.
 * - `montantValide` nul ou 0 : `EN_ATTENTE_VALIDATION` (rien n'a encore
 *   été validé).
 * - `0 < montantValide < montant demandé` : `PARTIELLEMENT_VALIDEE`.
 * - `montantValide === montant demandé` (entièrement validé, en une ou
 *   plusieurs fois) : le statut dépend alors de `getTotalRegle` —
 *   `VALIDEE_NON_REGLEE` (rien réglé), `PARTIELLEMENT_REGLEE` (réglé
 *   partiel), `REGLEE` (réglé >= validé). **Le statut `VALIDEE` n'est donc
 *   plus jamais produit par cette fonction** : il reste dans l'enum pour la
 *   compatibilité (voir `STATUTS_VALIDATION_COMPLETE` ci-dessus) mais
 *   correspond à un état transitoire immédiatement remplacé par l'un de
 *   ces trois statuts plus précis dès que `calculerStatutDemande` tourne.
 */
export async function calculerStatutDemande(demandeId: string): Promise<StatutDemande> {
  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    throw new Error(`calculerStatutDemande : demande ${demandeId} introuvable.`);
  }

  if (demande.statut === "REJETEE" || demande.statut === "CLOTUREE") {
    return demande.statut;
  }

  const montantDemandeCents = toCents(Number(demande.montant));
  const montantValideCents = toCents(Number(demande.montantValide ?? 0));

  let nouveauStatut: StatutDemande;
  if (montantValideCents <= 0) {
    nouveauStatut = "EN_ATTENTE_VALIDATION";
  } else if (montantValideCents < montantDemandeCents) {
    nouveauStatut = "PARTIELLEMENT_VALIDEE";
  } else {
    const totalRegleCents = toCents(await getTotalRegle(demandeId));
    if (totalRegleCents <= 0) {
      nouveauStatut = "VALIDEE_NON_REGLEE";
    } else if (totalRegleCents < montantValideCents) {
      nouveauStatut = "PARTIELLEMENT_REGLEE";
    } else {
      nouveauStatut = "REGLEE";
    }
  }

  if (nouveauStatut !== demande.statut) {
    await prisma.demande.update({ where: { id: demandeId }, data: { statut: nouveauStatut } });
  }

  return nouveauStatut;
}

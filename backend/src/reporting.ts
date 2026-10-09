import { LIBELLE_ETAPE_CIRCUIT } from "./circuitDemande";
import { construireLigneReporting, type HistoriqueReporting, type LigneReportingDemande } from "./reportingDemandeLigne";
import { getBeneficiaireNom } from "./beneficiaire";
import type { ModeReglement, Prisma, StatutDemande, TypeDemande } from "./generated/prisma/client";
import {
  getDemandesEnAttenteValidation,
  getDepensesNonJustifiees,
  getFondsRemisARegulariser,
  getMontantsValidesNonRegles,
  getReglementsPartielsACompleter,
  getRetoursEnAttenteReception,
} from "./dashboardFinance";
import { prisma } from "./prisma";
import { getMontantConsommeCategorie, getSoldeCaisse } from "./tresorerie";

/**
 * Filtres du reporting Trésorerie (Ticket 10), partagés entre l'écran
 * (`treso/finance/reporting/page.tsx`) et l'export Excel
 * (`api/treso/reporting/export/route.ts`) — les deux DOIVENT désigner
 * exactement le même jeu de données pour un même jeu de filtres, donc
 * jamais deux implémentations séparées des mêmes requêtes.
 */
export interface ReportingFilters {
  du?: Date;
  au?: Date;
  demandeurId?: string;
  service?: string;
  categorieId?: string;
  objetId?: string;
  mode?: ModeReglement;
  statut?: StatutDemande;
  /** Standard / Dépense directe (Phase F, section 15 du cahier des charges). */
  typeDemande?: TypeDemande;
  /**
   * Bénéficiaire (Phase A/H), DISTINCT du filtre "demandeur"
   * (`demandeurId`, toujours un `User` — le créateur). Le bénéficiaire
   * n'est pas toujours un utilisateur du système (Phase A) : au plus un
   * seul des deux champs ci-dessous est renseigné à la fois, jamais les
   * deux — voir `parseReportingFilters` pour le décodage du paramètre
   * unique `beneficiaire` qui les distingue (préfixe `u:`/`n:`).
   */
  beneficiaireUserId?: string;
  beneficiaireNom?: string;
}

type SearchParamsLike = Record<string, string | string[] | undefined>;

function firstString(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.trim() ? v.trim() : undefined;
}

/**
 * Parse les filtres depuis les search params de l'URL (GET, partageable) —
 * aucune valeur absente ou vide n'est retenue (filtre non appliqué).
 * `au` est traité comme fin de journée incluse (23:59:59.999).
 */
export function parseReportingFilters(searchParams: SearchParamsLike): ReportingFilters {
  const du = firstString(searchParams.du);
  const au = firstString(searchParams.au);
  const mode = firstString(searchParams.mode);
  const statut = firstString(searchParams.statut);
  const typeDemande = firstString(searchParams.typeDemande);
  const beneficiaire = firstString(searchParams.beneficiaire);
  const beneficiaireUserId = beneficiaire?.startsWith("u:") ? beneficiaire.slice(2) : undefined;
  const beneficiaireNom = beneficiaire?.startsWith("n:")
    ? decodeURIComponent(beneficiaire.slice(2))
    : undefined;

  return {
    du: du ? new Date(du) : undefined,
    au: au ? new Date(`${au}T23:59:59.999`) : undefined,
    demandeurId: firstString(searchParams.demandeurId),
    service: firstString(searchParams.service),
    categorieId: firstString(searchParams.categorieId),
    objetId: firstString(searchParams.objetId),
    mode: mode === "CAISSE" || mode === "BANQUE" ? mode : undefined,
    // REFONTE V1 (temporaire, voir CLAUDE.md "Refonte V1 en cours") : liste
    // des valeurs mise à jour pour le nouvel enum à 11 statuts, mais le
    // reporting lui-même (regroupement par Catégorie/Objet) n'a pas encore
    // été repensé pour la refonte — périmètre laissé pour la phase
    // "dashboard enrichi".
    statut: (
      [
        "BROUILLON",
        "EN_ATTENTE_VALIDATION",
        "VALIDEE",
        "PARTIELLEMENT_VALIDEE",
        "VALIDEE_NON_REGLEE",
        "PARTIELLEMENT_REGLEE",
        "REGLEE",
        "REJETEE",
        "EN_ATTENTE_REGULARISATION",
        "REGULARISEE",
        "CLOTUREE",
        "ABANDONNEE",
      ] as const
    ).includes(statut as StatutDemande)
      ? (statut as StatutDemande)
      : undefined,
    typeDemande:
      typeDemande === "STANDARD" || typeDemande === "DEPENSE_DIRECTE" ? typeDemande : undefined,
    beneficiaireUserId,
    beneficiaireNom,
  };
}

/** Reconstruit la query string des filtres actifs (pour le lien d'export). */
export function reportingFiltersToQueryString(filters: ReportingFilters): string {
  const params = new URLSearchParams();
  if (filters.du) params.set("du", filters.du.toISOString().slice(0, 10));
  if (filters.au) params.set("au", filters.au.toISOString().slice(0, 10));
  if (filters.demandeurId) params.set("demandeurId", filters.demandeurId);
  if (filters.service) params.set("service", filters.service);
  if (filters.categorieId) params.set("categorieId", filters.categorieId);
  if (filters.objetId) params.set("objetId", filters.objetId);
  if (filters.mode) params.set("mode", filters.mode);
  if (filters.statut) params.set("statut", filters.statut);
  if (filters.typeDemande) params.set("typeDemande", filters.typeDemande);
  if (filters.beneficiaireUserId) params.set("beneficiaire", `u:${filters.beneficiaireUserId}`);
  else if (filters.beneficiaireNom) params.set("beneficiaire", `n:${encodeURIComponent(filters.beneficiaireNom)}`);
  return params.toString();
}

/**
 * Catégorisation par ligne (voir CLAUDE.md) : `categorieId`/`objetId`
 * doivent désormais matcher soit la demande elle-même (`DEPENSE_DIRECTE`,
 * seul cas où ces champs restent renseignés sur `Demande`), soit AU MOINS
 * une de ses lignes (`STANDARD`) — combiné via un `OR` explicite par
 * critère, l'ensemble regroupé dans un seul `AND` pour éviter toute clé
 * dupliquée (deux `OR` distincts ne peuvent pas cohabiter comme deux
 * propriétés du même objet littéral).
 */
function buildDemandeWhere(filters: ReportingFilters): Prisma.DemandeWhereInput {
  const clauses: Prisma.DemandeWhereInput[] = [];
  if (filters.du || filters.au) {
    clauses.push({
      createdAt: { ...(filters.du ? { gte: filters.du } : {}), ...(filters.au ? { lte: filters.au } : {}) },
    });
  }
  if (filters.demandeurId) clauses.push({ createurId: filters.demandeurId });
  if (filters.service) clauses.push({ createur: { service: { name: filters.service } } });
  if (filters.categorieId) {
    clauses.push({
      OR: [{ categorieId: filters.categorieId }, { lignes: { some: { categorieId: filters.categorieId } } }],
    });
  }
  if (filters.objetId) {
    clauses.push({ OR: [{ objetId: filters.objetId }, { lignes: { some: { objetId: filters.objetId } } }] });
  }
  if (filters.statut) clauses.push({ statut: filters.statut });
  if (filters.typeDemande) clauses.push({ typeDemande: filters.typeDemande });
  if (filters.beneficiaireUserId) clauses.push({ beneficiaireUserId: filters.beneficiaireUserId });
  if (filters.beneficiaireNom) clauses.push({ beneficiaireNom: filters.beneficiaireNom });
  return clauses.length > 0 ? { AND: clauses } : {};
}

/**
 * Bénéficiaires connus (Phase H) pour le sélecteur du formulaire de
 * filtres — DISTINCT du filtre "demandeur" (toujours un `User`, le
 * créateur). Combine les utilisateurs déjà bénéficiaires d'au moins une
 * demande (`beneficiaireUserId`) et les noms libres déjà utilisés
 * (`beneficiaireNom` — fournisseurs, "SIM ASSURANCES CI", stagiaires sans
 * compte...), chacun encodé avec un préfixe (`u:`/`n:`) pour que
 * `parseReportingFilters` sache lequel des deux champs renseigner. Deux
 * `findMany distinct` légers (pas de jointure lourde), le nombre de
 * bénéficiaires distincts restant modeste pour une application interne.
 */
export async function getBeneficiairesConnus(): Promise<{ value: string; label: string }[]> {
  const [avecCompte, sansCompte] = await Promise.all([
    prisma.demande.findMany({
      where: { beneficiaireUserId: { not: null } },
      distinct: ["beneficiaireUserId"],
      select: { beneficiaireUserId: true, beneficiaireUser: { select: { fullName: true } } },
    }),
    prisma.demande.findMany({
      where: { beneficiaireNom: { not: null } },
      distinct: ["beneficiaireNom"],
      select: { beneficiaireNom: true },
    }),
  ]);

  const options = [
    ...avecCompte
      .filter((d): d is typeof d & { beneficiaireUserId: string; beneficiaireUser: { fullName: string } } =>
        Boolean(d.beneficiaireUserId && d.beneficiaireUser)
      )
      .map((d) => ({ value: `u:${d.beneficiaireUserId}`, label: d.beneficiaireUser.fullName })),
    ...sansCompte
      .filter((d): d is { beneficiaireNom: string } => Boolean(d.beneficiaireNom))
      .map((d) => ({ value: `n:${encodeURIComponent(d.beneficiaireNom)}`, label: d.beneficiaireNom })),
  ];

  return options.sort((a, b) => a.label.localeCompare(b.label));
}

export interface MontantsRegle {
  total: number;
  caisse: number;
  banque: number;
}

/**
 * Montants réglés par demande (règlements confirmés, non annulés), groupés
 * par demande ET par mode en **une seule requête** `groupBy` — jamais une
 * requête par demande. Renvoie systématiquement les trois totaux (global,
 * Caisse, Banque) pour que `Réglé = Réglé Caisse + Réglé Banque` reste vrai
 * pour CHAQUE ligne du reporting, quel que soit le filtre `mode` actif :
 * ce dernier ne sert plus qu'à sélectionner QUELLES demandes apparaissent
 * (celles ayant au moins un règlement de ce mode), jamais à tronquer les
 * montants affichés d'une demande déjà retenue.
 */
async function getMontantsRegleParDemande(demandeIds: string[]): Promise<Map<string, MontantsRegle>> {
  if (demandeIds.length === 0) {
    return new Map();
  }
  const sommes = await prisma.reglement.groupBy({
    by: ["demandeId", "mode"],
    where: { demandeId: { in: demandeIds }, estConfirme: true, estAnnule: false },
    _sum: { montant: true },
  });

  const map = new Map<string, MontantsRegle>();
  for (const s of sommes) {
    const montant = Number(s._sum.montant ?? 0);
    const entry = map.get(s.demandeId) ?? { total: 0, caisse: 0, banque: 0 };
    entry.total += montant;
    if (s.mode === "CAISSE") {
      entry.caisse += montant;
    } else {
      entry.banque += montant;
    }
    map.set(s.demandeId, entry);
  }
  return map;
}

interface DemandeAvecRelations {
  id: string;
  reference: string;
  montant: Prisma.Decimal;
  /** Phase H : base de la colonne "Validé" du tableau agrégé (capture aussi les validations partielles). */
  montantValide: Prisma.Decimal | null;
  statut: StatutDemande;
  typeDemande: TypeDemande;
  createdAt: Date;
  /** Motif d'en-tête : anciennes demandes et dépenses directes ; `null` pour une demande à motifs par ligne. */
  description: string | null;
  categorieId: string | null;
  objetId: string | null;
  categorie: { label: string } | null;
  objet: { label: string } | null;
  createur: { fullName: string; service: string | null };
  beneficiaireUserId: string | null;
  beneficiaireNom: string | null;
  beneficiaireUser: { fullName: string } | null;
  /** Catégorisation par ligne (voir CLAUDE.md) — uniquement peuplé pour
   * `STANDARD` (toujours vide pour `DEPENSE_DIRECTE`, qui n'a pas de
   * ligne). Sert de base à `getUnitesComptables` ci-dessous. */
  lignes: {
    id: string;
    libelle: string;
    motif: string | null;
    quantite: number;
    prixUnitaire: Prisma.Decimal;
    statutValidation: string;
    categorieId: string | null;
    objetId: string | null;
    categorie: { label: string } | null;
    objet: { label: string } | null;
  }[];
}

/**
 * "Unité comptable" — voir CLAUDE.md "Catégorisation par ligne" : unifie
 * `DEPENSE_DIRECTE` (0 ligne, la demande ENTIÈRE porte sa propre catégorie)
 * et `STANDARD` (chaque LIGNE porte la sienne, potentiellement différente
 * d'une ligne à l'autre) sous une même forme, pour que
 * `getReportingRows`/`getReportingFondsRemis`
 * n'aient qu'un seul bucketing à écrire, jamais deux chemins de code
 * séparés selon `typeDemande`.
 *
 * `montant`/`montantValide` sont ceux de l'UNITÉ (la ligne, ou la demande
 * entière si `DEPENSE_DIRECTE`) — jamais ceux de la demande complète pour
 * une ligne, qui compterait alors le montant des AUTRES lignes en trop
 * dans le même bucket.
 */
export interface UniteComptable {
  demandeId: string;
  /** `null` pour une DEPENSE_DIRECTE (une seule "unité" = la demande elle-même). */
  ligneId: string | null;
  categorieId: string | null;
  categorieLabel: string;
  objetId: string | null;
  objetLabel: string;
  montant: number;
  montantValide: number;
}

function getUnitesComptables(demandes: DemandeAvecRelations[]): UniteComptable[] {
  const unites: UniteComptable[] = [];
  for (const d of demandes) {
    if (d.typeDemande === "DEPENSE_DIRECTE") {
      unites.push({
        demandeId: d.id,
        ligneId: null,
        categorieId: d.categorieId,
        categorieLabel: d.categorie?.label ?? "Non catégorisée",
        objetId: d.objetId,
        objetLabel: d.objet?.label ?? "Non renseigné",
        montant: Number(d.montant),
        montantValide: Number(d.montantValide ?? 0),
      });
    } else {
      for (const ligne of d.lignes) {
        const montantLigne = ligne.quantite * Number(ligne.prixUnitaire);
        unites.push({
          demandeId: d.id,
          ligneId: ligne.id,
          categorieId: ligne.categorieId,
          categorieLabel: ligne.categorie?.label ?? "Non catégorisée",
          objetId: ligne.objetId,
          objetLabel: ligne.objet?.label ?? "Non renseigné",
          montant: montantLigne,
          montantValide: ligne.statutValidation === "VALIDEE" ? montantLigne : 0,
        });
      }
    }
  }
  return unites;
}

/**
 * Demandes correspondant aux filtres, **après application du filtre
 * `mode`** (exclusion des demandes sans aucun règlement confirmé de ce
 * mode précis) — fonction interne partagée par `getReportingRows`, `getReportingParDemande` et les
 * autres feuilles, pour ne calculer cette liste qu'une fois
 * par appel et garantir que le tableau agrégé et le détail Excel désignent
 * toujours le même ensemble de demandes. Le filtre `mode` ne sert qu'à
 * SÉLECTIONNER les demandes retenues ; les montants renvoyés
 * (`montantsRegleParDemande`) restent les totaux complets (tous modes) de
 * chaque demande retenue — voir `getMontantsRegleParDemande`.
 */
async function getDemandesFiltrees(
  filters: ReportingFilters
): Promise<{ demandes: DemandeAvecRelations[]; montantsRegleParDemande: Map<string, MontantsRegle> }> {
  const demandes = await prisma.demande.findMany({
    where: buildDemandeWhere(filters),
    include: {
      categorie: true,
      objet: true,
      createur: { include: { service: true } },
      beneficiaireUser: true,
      lignes: { include: { categorie: true, objet: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const demandesFormatees: DemandeAvecRelations[] = demandes.map((d) => ({
    ...d,
    createur: {
      fullName: d.createur.fullName,
      service: d.createur.service?.name ?? null,
    },
  }));

  const montantsRegleParDemande = await getMontantsRegleParDemande(demandes.map((d) => d.id));

  const demandesFiltrees = filters.mode
    ? demandesFormatees.filter((d) => {
        const montants = montantsRegleParDemande.get(d.id);
        if (!montants) return false;
        return filters.mode === "CAISSE" ? montants.caisse > 0 : montants.banque > 0;
      })
    : demandesFormatees;

  return { demandes: demandesFiltrees, montantsRegleParDemande };
}


interface FondsRemis {
  nombreOperations: number;
  montantRemis: number;
  depensesDeclarees: number;
  retoursRecus: number;
}

/**
 * "Fonds remis" par demande — section 15 du cahier des charges (batché,
 * jamais une requête par demande, même principe que
 * `getMontantsRegleParDemande`) :
 * - `nombreOperations`/`montantRemis` : règlements CAISSE confirmés et non
 *   annulés (un "fonds remis" = une remise d'espèces à un collaborateur,
 *   donc un règlement Caisse précisément — jamais les règlements Banque,
 *   qui n'ont aucun cycle de fonds remis).
 * - `depensesDeclarees` : somme des `DepenseLigne` de tous les
 *   `RetourCaisse` liés à ces règlements (réceptionnés ou non — même
 *   convention que `getDepensesDeclarees`, `tresorerie.ts`).
 * - `retoursRecus` : somme des `montantARetourner` des retours
 *   **réceptionnés uniquement** (même convention que `getRetoursRecus`).
 *
 * Une demande absente de la Map n'a aucun règlement Caisse confirmé — donc
 * aucun fonds remis à régulariser, à exclure de `getReportingFondsRemis`.
 */
async function getFondsRemisParDemande(demandeIds: string[]): Promise<Map<string, FondsRemis>> {
  if (demandeIds.length === 0) {
    return new Map();
  }

  const reglementsCaisse = await prisma.reglement.groupBy({
    by: ["demandeId"],
    where: { demandeId: { in: demandeIds }, mode: "CAISSE", estConfirme: true, estAnnule: false },
    _count: { _all: true },
    _sum: { montant: true },
  });
  if (reglementsCaisse.length === 0) {
    return new Map();
  }

  const map = new Map<string, FondsRemis>();
  for (const r of reglementsCaisse) {
    map.set(r.demandeId, {
      nombreOperations: r._count._all,
      montantRemis: Number(r._sum.montant ?? 0),
      depensesDeclarees: 0,
      retoursRecus: 0,
    });
  }

  const [lignes, retours] = await Promise.all([
    prisma.depenseLigne.findMany({
      where: { retourCaisse: { reglement: { demandeId: { in: demandeIds } } } },
      select: { montant: true, retourCaisse: { select: { reglement: { select: { demandeId: true } } } } },
    }),
    prisma.retourCaisse.findMany({
      where: { estReceptionne: true, reglement: { demandeId: { in: demandeIds } } },
      select: { montantARetourner: true, reglement: { select: { demandeId: true } } },
    }),
  ]);

  for (const l of lignes) {
    const entry = map.get(l.retourCaisse.reglement.demandeId);
    if (entry) entry.depensesDeclarees += Number(l.montant);
  }
  for (const r of retours) {
    const entry = map.get(r.reglement.demandeId);
    if (entry) entry.retoursRecus += Number(r.montantARetourner);
  }
  const rembourses = await prisma.remboursementRetour.findMany({
    where: { statut: "VALIDE", retourCaisse: { reglement: { demandeId: { in: demandeIds } } } },
    select: { montant: true, retourCaisse: { select: { reglement: { select: { demandeId: true } } } } },
  });
  for (const rb of rembourses) {
    const entry = map.get(rb.retourCaisse.reglement.demandeId);
    if (entry) entry.retoursRecus -= Number(rb.montant);
  }
  // Retours exceptionnels post-clôture VALIDÉS : comptés comme retours reçus
  // (jamais ceux en attente/rejetés) — voir CLAUDE.md.
  const exceptionnels = await prisma.retourExceptionnel.findMany({
    where: { statut: "VALIDE", demandeId: { in: demandeIds } },
    select: { montant: true, demandeId: true },
  });
  for (const e of exceptionnels) {
    const entry = map.get(e.demandeId);
    if (entry) entry.retoursRecus += Number(e.montant);
  }

  return map;
}

interface AllocationsParCategorie {
  total: number;
  caisse: number;
  banque: number;
  nombreOperationsCaisse: number;
}

/**
 * Montants RÉGLÉS agrégés par (Demande, Catégorie) — voir CLAUDE.md
 * "Allocation budgétaire explicite par règlement" — somme des
 * `ReglementCategorieAllocation.montant` (règlements confirmés, non
 * annulés) de CETTE demande précise pour CETTE catégorie précise, ventilée
 * par mode. **Exacte** (jamais une estimation) : dérivée de la même
 * donnée que `getMontantConsommeCategorie`, simplement conservée par
 * demande plutôt qu'agrégée globalement (nécessaire pour que
 * `getReportingRows`/`getReportingFondsRemis` puissent additionner
 * correctement la contribution de PLUSIEURS demandes à un même bucket
 * Catégorie×Objet, sans jamais confondre "la même catégorie apparaît deux
 * fois dans CETTE demande" avec "deux demandes différentes contribuent
 * à cette catégorie").
 *
 * **Granularité Catégorie, jamais Objet** : une allocation ne descend pas
 * au niveau Objet (elle n'existe qu'au niveau où le budget lui-même
 * s'applique). Pour une demande `STANDARD` dont plusieurs lignes de MÊME
 * catégorie ont des Objets différents, les appelants répètent donc le
 * MÊME total "Réglé" de cette (demande, catégorie) sur chaque ligne Objet
 * concernée (la donnée la plus précise réellement disponible) — jamais
 * sommé une seconde fois pour la même (demande, catégorie). Documenté
 * aussi dans CLAUDE.md "Catégorisation par ligne", signalé explicitement
 * comme point à confirmer.
 */
async function getMontantsAllocationsParCategorie(
  demandeIds: string[]
): Promise<Map<string, AllocationsParCategorie>> {
  if (demandeIds.length === 0) return new Map();

  const cle = (demandeId: string, categorieId: string) => `${demandeId}|${categorieId}`;

  const allocations = await prisma.reglementCategorieAllocation.findMany({
    where: { reglement: { demandeId: { in: demandeIds }, estConfirme: true, estAnnule: false } },
    select: { categorieId: true, montant: true, reglement: { select: { demandeId: true, mode: true } } },
  });

  const map = new Map<string, AllocationsParCategorie>();
  for (const a of allocations) {
    const key = cle(a.reglement.demandeId, a.categorieId);
    const entry = map.get(key) ?? { total: 0, caisse: 0, banque: 0, nombreOperationsCaisse: 0 };
    const montant = Number(a.montant);
    entry.total += montant;
    if (a.reglement.mode === "CAISSE") {
      entry.caisse += montant;
      entry.nombreOperationsCaisse += 1;
    } else {
      entry.banque += montant;
    }
    map.set(key, entry);
  }
  return map;
}

export interface ReportingFondsRemisRow {
  categorieId: string | null;
  categorieLabel: string;
  objetId: string | null;
  objetLabel: string;
  /** Nombre d'ALLOCATIONS Caisse confirmées (pas de règlements — un
   * règlement réparti sur plusieurs catégories compte pour une opération
   * dans CHACUNE de ses catégories, chacune ayant réellement reçu une part
   * de cette remise d'espèces). */
  nombreOperations: number;
  montantDemande: number;
  montantValide: number;
  /** Somme des règlements Caisse confirmés du groupe — les fonds effectivement remis en espèces. */
  montantRemis: number;
  depensesDeclarees: number;
  retoursRecus: number;
  /**
   * `montantRemis - depensesDeclarees - retoursRecus` — **jamais plafonné à
   * 0** (contrairement à `montantRestantAValider`/`valideResteARegler` de
   * `getReportingRows`) : un solde négatif signale une anomalie réelle
   * (sur-retour), la même convention que `getSoldeARegulariser`/`getEcart`
   * (`tresorerie.ts`), jamais masquée par un `max(0, ...)`.
   */
  montantRestantARegulariser: number;
}

/**
 * Tableau "Fonds remis" dédié (section 15 du cahier des charges) — distinct
 * du tableau agrégé général (`getReportingRows`) : ne retient que les
 * demandes ayant au moins un règlement Caisse confirmé (les seules à avoir
 * un cycle de fonds remis), groupées par Catégorie/Objet comme le tableau
 * général, avec les colonnes exactes demandées : nombre d'opérations,
 * montant demandé, montant validé, montant remis, dépenses déclarées,
 * retours reçus, montant restant à régulariser.
 *
 * **Catégorisation par ligne (voir CLAUDE.md)** : bucketé par "unité
 * comptable" (`getUnitesComptables` — une ligne pour `STANDARD`, la
 * demande entière pour `DEPENSE_DIRECTE`) au lieu d'une demande entière
 * systématique. `montantRemis` (Caisse) est **exact**, dérivé de
 * `getMontantsAllocationsParCategorie` (allocations explicites, jamais
 * estimées). `depensesDeclarees`/`retoursRecus`, en revanche, n'ont AUCUNE
 * dimension Catégorie dans le modèle de données (un `RetourCaisse`/une
 * `DepenseLigne` se rattachent à un `Reglement`, jamais à une Catégorie) —
 * **seule estimation de cette tâche** : répartie au prorata de la part de
 * `montantRemis` que représente chaque catégorie dans le total remis de
 * LA MÊME demande (ratio = 100% pour toute `DEPENSE_DIRECTE`, ou pour une
 * `STANDARD` n'ayant qu'une seule catégorie concernée — comportement donc
 * strictement inchangé dans ces deux cas très majoritaires). Signalé
 * explicitement : à confirmer si une répartition plus précise est
 * nécessaire un jour (impliquerait de faire porter aussi une Catégorie
 * aux `DepenseLigne`/`RetourCaisse` eux-mêmes, hors périmètre ici).
 */
export async function getReportingFondsRemis(filters: ReportingFilters): Promise<ReportingFondsRemisRow[]> {
  const { demandes } = await getDemandesFiltrees(filters);
  const demandeIds = demandes.map((d) => d.id);
  const [fondsParDemande, allocationsParCategorie] = await Promise.all([
    getFondsRemisParDemande(demandeIds),
    getMontantsAllocationsParCategorie(demandeIds),
  ]);

  const buckets = new Map<string, ReportingFondsRemisRow>();
  // Garantit qu'une (demande, catégorie) ne contribue à `montantRemis`/
  // `nombreOperations`/`depensesDeclarees`/`retoursRecus` qu'UNE SEULE FOIS
  // au total agrégé, même si plusieurs lignes Objet de cette demande
  // partagent cette catégorie (sans quoi une catégorie couvrant 2 Objets
  // dans une même demande compterait deux fois le même montant remis).
  const demandeCategorieDejaComptee = new Set<string>();

  for (const d of demandes) {
    const fonds = fondsParDemande.get(d.id);
    if (!fonds) continue; // Aucun règlement Caisse confirmé : hors périmètre "fonds remis".

    const unites = getUnitesComptables([d]);
    // Total Caisse de CETTE demande, dérivé des allocations de ses propres
    // catégories (jamais un second calcul divergent de `fonds.montantRemis`
    // qui, lui, vient directement des règlements — les deux DOIVENT
    // coïncider ; utilisé uniquement comme dénominateur du prorata).
    const categoriesDeLaDemande = [...new Set(unites.map((u) => u.categorieId).filter((id): id is string => id != null))];
    const totalCaisseDemande = categoriesDeLaDemande.reduce(
      (sum, catId) => sum + (allocationsParCategorie.get(`${d.id}|${catId}`)?.caisse ?? 0),
      0
    );

    for (const unite of unites) {
      const cleDemandeCategorie = unite.categorieId ? `${d.id}|${unite.categorieId}` : null;
      const dejaComptee = cleDemandeCategorie != null && demandeCategorieDejaComptee.has(cleDemandeCategorie);

      const montantRemisCategorie = unite.categorieId
        ? (allocationsParCategorie.get(cleDemandeCategorie!)?.caisse ?? 0)
        : fonds.montantRemis; // Non catégorisée : pas de ventilation possible, tout le montant remis de la demande.
      const ratio = totalCaisseDemande > 0 ? montantRemisCategorie / totalCaisseDemande : 1;

      const key = `${unite.categorieId ?? "none"}|${unite.objetId ?? "none"}`;
      const existing = buckets.get(key);
      const contribution = {
        // 0 si cette (demande, catégorie) a déjà contribué via un autre
        // bucket Objet de la même demande — jamais compté deux fois.
        nombreOperations: dejaComptee
          ? 0
          : unite.categorieId
            ? (allocationsParCategorie.get(cleDemandeCategorie!)?.nombreOperationsCaisse ?? 0)
            : fonds.nombreOperations,
        montantDemande: unite.montant,
        montantValide: unite.montantValide,
        montantRemis: dejaComptee ? 0 : montantRemisCategorie,
        depensesDeclarees: dejaComptee ? 0 : fonds.depensesDeclarees * ratio,
        retoursRecus: dejaComptee ? 0 : fonds.retoursRecus * ratio,
      };
      if (cleDemandeCategorie) demandeCategorieDejaComptee.add(cleDemandeCategorie);

      if (existing) {
        existing.montantDemande += contribution.montantDemande;
        existing.montantValide += contribution.montantValide;
        existing.montantRemis += contribution.montantRemis;
        existing.nombreOperations += contribution.nombreOperations;
        existing.depensesDeclarees += contribution.depensesDeclarees;
        existing.retoursRecus += contribution.retoursRecus;
      } else {
        buckets.set(key, {
          categorieId: unite.categorieId,
          categorieLabel: unite.categorieLabel,
          objetId: unite.objetId,
          objetLabel: unite.objetLabel,
          nombreOperations: contribution.nombreOperations,
          montantDemande: contribution.montantDemande,
          montantValide: contribution.montantValide,
          montantRemis: contribution.montantRemis,
          depensesDeclarees: contribution.depensesDeclarees,
          retoursRecus: contribution.retoursRecus,
          montantRestantARegulariser: 0,
        });
      }
    }
  }

  const rows = Array.from(buckets.values());
  for (const row of rows) {
    row.montantRestantARegulariser = row.montantRemis - row.depensesDeclarees - row.retoursRecus;
  }

  return rows.sort(
    (a, b) => a.categorieLabel.localeCompare(b.categorieLabel) || a.objetLabel.localeCompare(b.objetLabel)
  );
}

export interface ReportingRow {
  categorieId: string | null;
  categorieLabel: string;
  objetId: string | null;
  objetLabel: string;
  nombreDemandes: number;
  /** Somme des montants de TOUTES les demandes du groupe, quel que soit leur statut. */
  montantDemande: number;
  /**
   * Phase H (voir CLAUDE.md "Refonte V1 en cours") : somme du champ
   * `Demande.montantValide` lui-même, PAS une somme conditionnée par le
   * statut comme avant cette phase — capture donc aussi les validations
   * partielles (une demande `PARTIELLEMENT_VALIDEE` contribue son
   * `montantValide` réel, pas 0 et pas son montant demandé en entier).
   */
  montantValide: number;
  /**
   * Phase H — montant RESTANT À VALIDER : `max(0, montantDemande -
   * montantValide)`. À NE JAMAIS CONFONDRE avec `valideResteARegler`
   * ci-dessous : celui-ci porte sur la validation (rien à voir avec le
   * règlement), celui-là sur le règlement du montant déjà validé.
   */
  montantRestantAValider: number;
  /** Somme de tous les règlements confirmés et non annulés (Caisse + Banque) — `getTotalRegle`. */
  montantRegle: number;
  /**
   * Montant VALIDÉ restant à RÉGLER : `max(0, montantValide -
   * montantRegle)`, jamais négatif. Renommé depuis `resteARegler` (Phase H)
   * pour ne pas le confondre avec `montantRestantAValider` — deux notions
   * distinctes qui n'ont jamais le même sens.
   */
  valideResteARegler: number;
  /** Règlements confirmés et non annulés en mode CAISSE uniquement. */
  montantRegleCaisse: number;
  /** Règlements confirmés et non annulés en mode BANQUE uniquement. */
  montantRegleBanque: number;
}

/**
 * Tableau agrégé par Catégorie puis Objet (Ticket 10, Tâche 1 ; complété
 * lors de l'audit de conformité — section 15 — puis à la Phase H pour le
 * nouveau modèle de validation partielle) : nombre de demandes, montant
 * demandé (toutes demandes), montant validé (`Demande.montantValide`),
 * montant restant à valider, montant réglé (Caisse + Banque confondus),
 * montant validé restant à régler, et la répartition Caisse/Banque du
 * réglé. Calculés en mémoire à partir d'une seule requête `findMany` + un
 * seul `groupBy`, jamais une requête par demande.
 *
 * Ne porte plus de budget (l'ancien `budgetAlloue` cumulé par groupe,
 * dérivé de `Demande.budgetDisponible`, a été retiré avec ce champ — voir
 * CLAUDE.md "Budget partagé par Catégorie") : le budget est désormais une
 * enveloppe PARTAGÉE par Catégorie, sans lien avec ce regroupement
 * Catégorie×Objet — voir `getReportingSuiviBudgetaire` ci-dessous, section
 * dédiée du reporting.
 *
 * Convention documentée (CLAUDE.md) : "Demandé" inclut TOUTES les demandes
 * correspondant aux filtres actifs, quel que soit leur statut (y compris
 * REJETEE et EN_ATTENTE_VALIDATION) — c'est la colonne qui répond à
 * "combien a-t-on demandé au total", par opposition à "Validé"/"Réglé" qui
 * ne comptent que ce qui a réellement avancé dans le circuit. Une demande
 * REJETEE ou jamais validée a `montantValide = 0` (ou `null` en base),
 * donc ne contribue jamais à "Validé", "Réglé", "Validé restant à régler"
 * ni aux colonnes Caisse/Banque — uniquement à "Demandé", "Restant à
 * valider" (égal au montant demandé dans ce cas) et au nombre de demandes.
 *
 * **Catégorisation par ligne (voir CLAUDE.md)** : bucketé par "unité
 * comptable" (`getUnitesComptables`) — une `DEPENSE_DIRECTE` reste une
 * seule unité (comportement inchangé), une `STANDARD` en apporte une par
 * ligne, chacune dans le bucket de SA PROPRE catégorie/objet avec SON
 * PROPRE montant (`nombreDemandes` devient donc, pour une demande
 * `STANDARD`, un nombre de LIGNES contributrices, pas de demandes —
 * cohérent avec le fait qu'une même demande peut désormais alimenter
 * plusieurs lignes du tableau). "Réglé"/"Réglé Caisse"/"Réglé Banque"
 * sont **exacts** (`getMontantsAllocationsParCategorie`, allocations
 * explicites) — jamais estimés, contrairement à
 * `depensesDeclarees`/`retoursRecus` de `getReportingFondsRemis` (qui,
 * eux, n'ont pas d'équivalent ici). Une (demande, catégorie) ne contribue
 * qu'UNE SEULE FOIS à ces trois colonnes, même si sa catégorie couvre
 * plusieurs Objets dans la même demande (même garde-fou que
 * `getReportingFondsRemis`, voir ce commentaire pour le détail).
 */
export async function getReportingRows(filters: ReportingFilters): Promise<ReportingRow[]> {
  const { demandes } = await getDemandesFiltrees(filters);
  const demandeIds = demandes.map((d) => d.id);
  const allocationsParCategorie = await getMontantsAllocationsParCategorie(demandeIds);

  const buckets = new Map<string, ReportingRow>();
  const demandeCategorieDejaComptee = new Set<string>();

  for (const d of demandes) {
    for (const unite of getUnitesComptables([d])) {
      const key = `${unite.categorieId ?? "none"}|${unite.objetId ?? "none"}`;
      const cleDemandeCategorie = unite.categorieId ? `${d.id}|${unite.categorieId}` : null;
      const dejaComptee = cleDemandeCategorie != null && demandeCategorieDejaComptee.has(cleDemandeCategorie);
      const montants = (cleDemandeCategorie != null ? allocationsParCategorie.get(cleDemandeCategorie) : undefined) ?? {
        total: 0,
        caisse: 0,
        banque: 0,
      };
      if (cleDemandeCategorie) demandeCategorieDejaComptee.add(cleDemandeCategorie);

      const existing = buckets.get(key);
      const contribution = {
        montantDemande: unite.montant,
        montantValide: unite.montantValide,
        montantRegle: dejaComptee ? 0 : montants.total,
        montantRegleCaisse: dejaComptee ? 0 : montants.caisse,
        montantRegleBanque: dejaComptee ? 0 : montants.banque,
      };
      if (existing) {
        existing.nombreDemandes += 1;
        existing.montantDemande += contribution.montantDemande;
        existing.montantValide += contribution.montantValide;
        existing.montantRegle += contribution.montantRegle;
        existing.montantRegleCaisse += contribution.montantRegleCaisse;
        existing.montantRegleBanque += contribution.montantRegleBanque;
      } else {
        buckets.set(key, {
          categorieId: unite.categorieId,
          categorieLabel: unite.categorieLabel,
          objetId: unite.objetId,
          objetLabel: unite.objetLabel,
          nombreDemandes: 1,
          montantDemande: contribution.montantDemande,
          montantValide: contribution.montantValide,
          montantRestantAValider: 0,
          montantRegle: contribution.montantRegle,
          valideResteARegler: 0,
          montantRegleCaisse: contribution.montantRegleCaisse,
          montantRegleBanque: contribution.montantRegleBanque,
        });
      }
    }
  }

  const rows = Array.from(buckets.values());
  for (const row of rows) {
    row.montantRestantAValider = Math.max(0, row.montantDemande - row.montantValide);
    row.valideResteARegler = Math.max(0, row.montantValide - row.montantRegle);
  }

  return rows.sort(
    (a, b) => a.categorieLabel.localeCompare(b.categorieLabel) || a.objetLabel.localeCompare(b.objetLabel)
  );
}

export interface ReportingSuiviBudgetaireRow {
  categorieId: string;
  categorieLabel: string;
  budgetAlloue: number;
  /** Somme des règlements confirmés et non annulés des demandes de cette Catégorie — `getMontantConsommeCategorie`. */
  montantConsomme: number;
  /** `budgetAlloue - montantConsomme`, **jamais plafonné à 0** — négatif = dépassement réel. */
  budgetRestant: number;
}

/**
 * "Suivi budgétaire" du reporting (Tâche 6, voir CLAUDE.md "Budget partagé
 * par Catégorie") — recâblé sur le nouveau mécanisme : le budget appartient
 * à la Catégorie (nature de la dépense), pas à une demande ni un service.
 * Une ligne par Catégorie ayant un `budgetAlloue` défini (`null` = illimité,
 * hors de cette liste), avec sa consommation réelle (règlements confirmés
 * et non annulés, tous demandeurs confondus — même formule exacte que le
 * contrôle bloquant de `confirmerReglementAction`, jamais une deuxième
 * définition) et son restant.
 *
 * **Volontairement NON filtré** par les paramètres du reporting (période,
 * demandeur...) — même principe que `getReportingDashboardSnapshot` : le
 * budget est une enveloppe cumulative depuis toujours (aucun renouvellement
 * périodique, voir CLAUDE.md), pas une donnée qui se prête à un découpage
 * par période. Nombre de catégories modeste (~9) : un `Promise.all` par
 * catégorie reste largement suffisant, jamais une requête par demande.
 */
export async function getReportingSuiviBudgetaire(): Promise<ReportingSuiviBudgetaireRow[]> {
  const categories = await prisma.categorie.findMany({
    where: { budgetAlloue: { not: null } },
    orderBy: { label: "asc" },
  });

  return Promise.all(
    categories.map(async (c) => {
      const budgetAlloue = Number(c.budgetAlloue);
      const montantConsomme = await getMontantConsommeCategorie(c.id);
      return {
        categorieId: c.id,
        categorieLabel: c.label,
        budgetAlloue,
        montantConsomme,
        budgetRestant: budgetAlloue - montantConsomme,
      };
    })
  );
}

export interface ReportingRetourExterneDetail {
  personne: string;
  estExterne: boolean;
  montantChequeInitial: number;
  montantRetourne: number;
  motif: string;
  date: Date;
  auteurNom: string;
  pieceChequeId: string | null;
  pieceRetourId: string;
}

/**
 * Feuille "Retours externes" (voir CLAUDE.md "Retour externe") : indépendante
 * des demandes (donc jamais soumise aux filtres demande/service/catégorie) —
 * seule la période (du/au) s'applique. Jamais mélangée aux retours de caisse.
 */
export async function getReportingRetoursExternesDetail(filters: ReportingFilters): Promise<ReportingRetourExterneDetail[]> {
  const retours = await prisma.retourExterne.findMany({
    where: { creeAt: { gte: filters.du, lte: filters.au } },
    include: { collaborateur: { select: { fullName: true } }, creePar: { select: { fullName: true } } },
    orderBy: { creeAt: "asc" },
  });
  return retours.map((r) => ({
    personne: r.collaborateur?.fullName ?? r.nomExterne ?? "—",
    estExterne: r.collaborateurId == null,
    montantChequeInitial: Number(r.montantChequeInitial),
    montantRetourne: Number(r.montantRetourne),
    motif: r.motif,
    date: r.creeAt,
    auteurNom: r.creePar.fullName,
    pieceChequeId: r.pieceJointeChequeId,
    pieceRetourId: r.pieceJointeId,
  }));
}

export interface ReportingMouvementBanqueDetail {
  demandeReference: string;
  type: "SORTIE" | "RETOUR" | "ANNULATION";
  montant: number;
  date: Date;
  auteurNom: string;
  /** Bordereau de versement joint (obligatoire pour un RETOUR). */
  bordereau: boolean;
}

/**
 * Feuille "Mouvements banque" de l'export : historique `JournalBanque` des
 * demandes filtrées (voir CLAUDE.md "Retour sur règlement Banque") —
 * traçabilité UNIQUEMENT, aucun solde banque n'est calculé.
 */
export async function getReportingJournalBanqueDetail(
  filters: ReportingFilters
): Promise<ReportingMouvementBanqueDetail[]> {
  const { demandes } = await getDemandesFiltrees(filters);
  const demandeIds = demandes.map((d) => d.id);
  if (demandeIds.length === 0) {
    return [];
  }
  const referenceParDemande = new Map(demandes.map((d) => [d.id, d.reference]));
  const mouvements = await prisma.journalBanque.findMany({
    where: { reglement: { demandeId: { in: demandeIds } } },
    include: { reglement: { select: { demandeId: true } }, creePar: { select: { fullName: true } } },
    orderBy: { creeAt: "asc" },
  });
  return mouvements.map((m) => ({
    demandeReference: referenceParDemande.get(m.reglement.demandeId) ?? "—",
    type: m.type,
    montant: Number(m.montant),
    date: m.creeAt,
    auteurNom: m.creePar.fullName,
    bordereau: m.pieceJointeId != null,
  }));
}

export interface ReportingJournalDetail {
  type: string;
  montant: number;
  source: string;
  createdAt: Date;
  /** Section 13 (traçabilité) : demande concernée. */
  demandeReference: string;
  /** Section 13 (traçabilité) : utilisateur ayant déclenché l'écriture. */
  userNom: string;
}

/**
 * Feuille "Journal de caisse" de l'export : grand livre `JournalCaisse`,
 * filtré **uniquement par période** — la catégorie/l'objet/le mode n'ont
 * pas de sens à ce niveau (une écriture n'a pas de catégorie), demande
 * explicite du cahier des charges. `demandeReference`/`userNom` (section 13)
 * viennent des relations `demande`/`user` ajoutées à `JournalCaisse` —
 * renseignées à la création de chaque écriture, jamais recalculées ici.
 */
export async function getReportingJournalDetail(filters: ReportingFilters): Promise<ReportingJournalDetail[]> {
  const entries = await prisma.journalCaisse.findMany({
    where: {
      ...(filters.du || filters.au
        ? { createdAt: { ...(filters.du ? { gte: filters.du } : {}), ...(filters.au ? { lte: filters.au } : {}) } }
        : {}),
    },
    include: { demande: { select: { reference: true } }, user: { select: { fullName: true } } },
    orderBy: { createdAt: "asc" },
  });
  return entries.map((e) => ({
    type: e.type,
    montant: Number(e.montant),
    source: e.source,
    createdAt: e.createdAt,
    // Solde d'ouverture (voir CLAUDE.md) : seul cas d'écriture sans
    // demande d'origine (`demandeId: null`) — jamais une exception ici.
    demandeReference: e.demande?.reference ?? "—",
    userNom: e.user.fullName,
  }));
}

export interface ReportingDashboardIndicateur {
  indicateur: string;
  nombre: number | null;
  montant: number | null;
}

/**
 * Feuille "Dashboard" de l'export (section 16) : les 6 indicateurs "À
 * traiter" du dashboard Finance (Phase G) + le solde de caisse, calculés
 * **au moment de l'export** — un instantané non filtré (les mêmes
 * fonctions que `treso/finance/page.tsx`, jamais une deuxième formule),
 * puisque ce sont par nature des indicateurs organisationnels globaux, pas
 * des données qui se prêtent aux filtres période/catégorie/demandeur du
 * reste du reporting.
 */
export async function getReportingDashboardSnapshot(): Promise<ReportingDashboardIndicateur[]> {
  const [solde, enAttenteValidation, montantsNonRegles, reglementsPartiels, fondsARegulariser, retoursEnAttente, depensesNonJustifiees] =
    await Promise.all([
      getSoldeCaisse(),
      getDemandesEnAttenteValidation(),
      getMontantsValidesNonRegles(),
      getReglementsPartielsACompleter(),
      getFondsRemisARegulariser(),
      getRetoursEnAttenteReception(),
      getDepensesNonJustifiees(),
    ]);

  return [
    { indicateur: "Solde de caisse", nombre: null, montant: solde },
    { indicateur: "Demandes en attente de validation", nombre: enAttenteValidation.nombre, montant: null },
    {
      indicateur: "Montants validés restant à régler",
      nombre: montantsNonRegles.nombre,
      montant: montantsNonRegles.montant,
    },
    {
      indicateur: "Règlements partiels à compléter",
      nombre: reglementsPartiels.nombre,
      montant: reglementsPartiels.montant,
    },
    { indicateur: "Fonds remis à régulariser", nombre: fondsARegulariser.nombre, montant: fondsARegulariser.montant },
    { indicateur: "Retours de fonds en attente de réception", nombre: retoursEnAttente.nombre, montant: null },
    {
      indicateur: "Dépenses non justifiées à suivre",
      nombre: depensesNonJustifiees.nombre,
      montant: depensesNonJustifiees.montant,
    },
  ];
}

/**
 * Reporting « une ligne par demande » (2026-10-08) — écran ET export Excel : mêmes filtres que le reste du reporting
 * (`getDemandesFiltrees`), puis tout ce qui est rattaché à chaque demande chargé en une poignée de requêtes groupées
 * (jamais une requête par demande), mis en forme par `construireLigneReporting` (pur, testé).
 *
 * Totaux identiques aux fonctions de référence : Réglé = `getTotalRegle` (confirmés, non annulés, tous modes), Dépensé =
 * `getDepensesDeclarees` (toutes les lignes de dépense de tous les retours), Retourné = `getRetoursRecus` (retours
 * réceptionnés + retours exceptionnels validés − remboursements validés), Solde = `getEcart`.
 */
export async function getReportingParDemande(
  filters: ReportingFilters,
  libelleStatut: (statut: StatutDemande) => string = (s) => s
): Promise<LigneReportingDemande[]> {
  const { demandes } = await getDemandesFiltrees(filters);
  const ids = demandes.map((d) => d.id);
  if (ids.length === 0) return [];

  const [details, historique] = await Promise.all([
    prisma.demande.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        etapeCircuit: true,
        lignes: {
          orderBy: { createdAt: "asc" },
          include: { categorie: true, objet: true, decidePar: { select: { fullName: true } } },
        },
        reglements: {
          orderBy: { createdAt: "asc" },
          include: {
            auteur: { select: { fullName: true } },
            retours: {
              orderBy: { createdAt: "asc" },
              include: {
                declarant: { select: { fullName: true } },
                receptionnePar: { select: { fullName: true } },
                depenses: { orderBy: { date: "asc" } },
                remboursements: {
                  orderBy: { proposeAt: "asc" },
                  include: { proposePar: { select: { fullName: true } }, validePar: { select: { fullName: true } } },
                },
              },
            },
          },
        },
        retoursExceptionnels: {
          orderBy: { saisiAt: "asc" },
          include: { saisiPar: { select: { fullName: true } }, validePar: { select: { fullName: true } } },
        },
      },
    }),
    prisma.historiqueEntry.findMany({
      where: { entity: "Demande", entityId: { in: ids } },
      include: { user: { select: { fullName: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const detailParId = new Map(details.map((d) => [d.id, d]));
  const historiqueParId = new Map<string, HistoriqueReporting[]>();
  for (const h of historique) {
    const liste = historiqueParId.get(h.entityId) ?? [];
    liste.push({ action: h.action, detail: h.detail, auteur: h.user.fullName, date: h.createdAt });
    historiqueParId.set(h.entityId, liste);
  }

  return demandes.map((d) => {
    const det = detailParId.get(d.id)!;
    return construireLigneReporting({
      reference: d.reference,
      creeLe: d.createdAt,
      typeDemande: d.typeDemande,
      statut: libelleStatut(d.statut),
      etapeCircuit: det.etapeCircuit ? LIBELLE_ETAPE_CIRCUIT[det.etapeCircuit] : null,
      demandeur: d.createur.fullName,
      service: d.createur.service,
      beneficiaire: getBeneficiaireNom(d),
      description: d.description,
      categorie: d.categorie?.label ?? null,
      objet: d.objet?.label ?? null,
      montantDemande: Number(d.montant),
      montantValide: Number(d.montantValide ?? 0),
      lignes: det.lignes.map((l) => ({
        libelle: l.libelle,
        motif: l.motif,
        quantite: l.quantite,
        prixUnitaire: Number(l.prixUnitaire),
        categorie: l.categorie?.label ?? null,
        objet: l.objet?.label ?? null,
        statut: l.statutValidation,
        motifRejet: l.motifRejet,
        decidePar: l.decidePar?.fullName ?? null,
        decideLe: l.decideAt,
      })),
      reglements: det.reglements.map((r) => ({
        montant: Number(r.montant),
        mode: r.mode,
        estConfirme: r.estConfirme,
        estAnnule: r.estAnnule,
        motifAnnulation: r.motifAnnulation,
        auteur: r.auteur.fullName,
        creeLe: r.createdAt,
        confirmeLe: r.confirmeAt,
        retours: r.retours.map((t) => ({
          montantARetourner: Number(t.montantARetourner),
          estReceptionne: t.estReceptionne,
          receptionneLe: t.receptionneAt,
          receptionnePar: t.receptionnePar?.fullName ?? null,
          declarant: t.declarant.fullName,
          declareLe: t.createdAt,
          creeParAssistant: t.creeParAssistant,
          complementSignalement: !!t.signalementOrigineId,
          reouvertureExceptionnelle: !!t.motifReouvertureExceptionnelle,
          depenses: t.depenses.map((dep) => ({
            libelle: dep.objet,
            montant: Number(dep.montant),
            justifiee: dep.justification !== "SANS_PIECE",
            motifNonJustifie: dep.motifNonJustifie,
          })),
          remboursements: t.remboursements.map((rb) => ({
            montant: Number(rb.montant),
            statut: rb.statut,
            proposePar: rb.proposePar.fullName,
            proposeLe: rb.proposeAt,
            validePar: rb.validePar?.fullName ?? null,
            valideLe: rb.valideAt,
            motifRejet: rb.motifRejet,
          })),
        })),
      })),
      retoursExceptionnels: det.retoursExceptionnels.map((e) => ({
        montant: Number(e.montant),
        statut: e.statut,
        saisiPar: e.saisiPar.fullName,
        saisiLe: e.saisiAt,
        validePar: e.validePar?.fullName ?? null,
        valideLe: e.valideAt,
        motifRejet: e.motifRejet,
      })),
      historique: historiqueParId.get(d.id) ?? [],
    });
  });
}

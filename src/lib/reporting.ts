import type { ModeReglement, Prisma, StatutDemande, TypeJustification } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

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
      ] as const
    ).includes(statut as StatutDemande)
      ? (statut as StatutDemande)
      : undefined,
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
  return params.toString();
}

function buildDemandeWhere(filters: ReportingFilters): Prisma.DemandeWhereInput {
  return {
    ...(filters.du || filters.au
      ? { createdAt: { ...(filters.du ? { gte: filters.du } : {}), ...(filters.au ? { lte: filters.au } : {}) } }
      : {}),
    ...(filters.demandeurId ? { createurId: filters.demandeurId } : {}),
    ...(filters.service ? { createur: { service: filters.service } } : {}),
    ...(filters.categorieId ? { categorieId: filters.categorieId } : {}),
    ...(filters.objetId ? { objetId: filters.objetId } : {}),
    ...(filters.statut ? { statut: filters.statut } : {}),
  };
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
  statut: StatutDemande;
  budgetDisponible: Prisma.Decimal | null;
  createdAt: Date;
  categorieId: string | null;
  objetId: string | null;
  categorie: { label: string } | null;
  objet: { label: string } | null;
  createur: { fullName: string; service: string | null };
}

/**
 * Demandes correspondant aux filtres, **après application du filtre
 * `mode`** (exclusion des demandes sans aucun règlement confirmé de ce
 * mode précis) — fonction interne partagée par `getReportingRows` et
 * `getReportingDemandesDetail`, pour ne calculer cette liste qu'une fois
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
    include: { categorie: true, objet: true, createur: true },
    orderBy: { createdAt: "asc" },
  });

  const montantsRegleParDemande = await getMontantsRegleParDemande(demandes.map((d) => d.id));

  const demandesFiltrees = filters.mode
    ? demandes.filter((d) => {
        const montants = montantsRegleParDemande.get(d.id);
        if (!montants) return false;
        return filters.mode === "CAISSE" ? montants.caisse > 0 : montants.banque > 0;
      })
    : demandes;

  return { demandes: demandesFiltrees, montantsRegleParDemande };
}

// REFONTE V1 (Phase A : CLOTUREE_TOTALE/CLOTUREE_PARTIELLE -> CLOTUREE.
// Phase B : la validation totale ne produit plus jamais VALIDEE — voir
// STATUTS_VALIDATION_COMPLETE dans src/lib/tresorerie.ts. Une demande
// seulement PARTIELLEMENT_VALIDEE ne compte volontairement pas comme
// "validée" ici : ce n'est pas le montant demandé qui est réellement acquis.
const STATUTS_VALIDES: readonly StatutDemande[] = [
  "VALIDEE",
  "VALIDEE_NON_REGLEE",
  "PARTIELLEMENT_REGLEE",
  "REGLEE",
  "CLOTUREE",
];

export interface ReportingRow {
  categorieId: string | null;
  categorieLabel: string;
  objetId: string | null;
  objetLabel: string;
  nombreDemandes: number;
  /** Somme des montants de TOUTES les demandes du groupe, quel que soit leur statut. */
  montantDemande: number;
  /** Somme des montants des demandes ayant au moins atteint VALIDEE (VALIDEE, CLOTUREE_TOTALE, CLOTUREE_PARTIELLE). */
  montantValide: number;
  /** Somme de tous les règlements confirmés et non annulés (Caisse + Banque). */
  montantRegle: number;
  /** max(0, montantValide - montantRegle) — jamais négatif. */
  resteARegler: number;
  /** Règlements confirmés et non annulés en mode CAISSE uniquement. */
  montantRegleCaisse: number;
  /** Règlements confirmés et non annulés en mode BANQUE uniquement. */
  montantRegleBanque: number;
  /** null si aucune demande de ce groupe n'a de `budgetDisponible` renseigné. */
  budgetAlloue: number | null;
}

/**
 * Tableau agrégé par Catégorie puis Objet (Ticket 10, Tâche 1 ; complété
 * lors de l'audit de conformité avec les 4 colonnes explicitement exigées
 * par le cahier des charges — section 15) : nombre de demandes, montant
 * demandé (toutes demandes), montant validé (VALIDEE ou clôturée), montant
 * réglé (Caisse + Banque confondus), reste à régler, et la répartition
 * Caisse/Banque du réglé — plus le budget alloué cumulé (Tâche 2, suivi
 * budgétaire). Calculés en mémoire à partir d'une seule requête `findMany`
 * + un seul `groupBy`, jamais une requête par demande.
 *
 * Convention documentée (CLAUDE.md) : "Demandé" inclut TOUTES les demandes
 * correspondant aux filtres actifs, quel que soit leur statut (y compris
 * REJETEE et EN_ATTENTE) — c'est la colonne qui répond à "combien a-t-on
 * demandé au total", par opposition à "Validé"/"Réglé" qui ne comptent que
 * ce qui a réellement avancé dans le circuit. Une demande REJETEE ne
 * contribue donc jamais à "Validé", "Réglé", "Reste à régler" ni aux
 * colonnes Caisse/Banque — uniquement à "Demandé" (et au nombre de
 * demandes).
 */
export async function getReportingRows(filters: ReportingFilters): Promise<ReportingRow[]> {
  const { demandes, montantsRegleParDemande } = await getDemandesFiltrees(filters);

  const buckets = new Map<string, ReportingRow>();
  for (const d of demandes) {
    const key = `${d.categorieId ?? "none"}|${d.objetId ?? "none"}`;
    const montants = montantsRegleParDemande.get(d.id) ?? { total: 0, caisse: 0, banque: 0 };
    const estValidee = STATUTS_VALIDES.includes(d.statut);
    const montantValideContribution = estValidee ? Number(d.montant) : 0;
    const budget = d.budgetDisponible != null ? Number(d.budgetDisponible) : null;

    const existing = buckets.get(key);
    if (existing) {
      existing.nombreDemandes += 1;
      existing.montantDemande += Number(d.montant);
      existing.montantValide += montantValideContribution;
      existing.montantRegle += montants.total;
      existing.montantRegleCaisse += montants.caisse;
      existing.montantRegleBanque += montants.banque;
      if (budget != null) {
        existing.budgetAlloue = (existing.budgetAlloue ?? 0) + budget;
      }
    } else {
      buckets.set(key, {
        categorieId: d.categorieId,
        categorieLabel: d.categorie?.label ?? "Non catégorisée",
        objetId: d.objetId,
        objetLabel: d.objet?.label ?? "Non renseigné",
        nombreDemandes: 1,
        montantDemande: Number(d.montant),
        montantValide: montantValideContribution,
        montantRegle: montants.total,
        resteARegler: 0,
        montantRegleCaisse: montants.caisse,
        montantRegleBanque: montants.banque,
        budgetAlloue: budget,
      });
    }
  }

  const rows = Array.from(buckets.values());
  for (const row of rows) {
    row.resteARegler = Math.max(0, row.montantValide - row.montantRegle);
  }

  return rows.sort(
    (a, b) => a.categorieLabel.localeCompare(b.categorieLabel) || a.objetLabel.localeCompare(b.objetLabel)
  );
}

export interface ReportingDemandeDetail {
  reference: string;
  createurNom: string;
  service: string | null;
  categorieLabel: string;
  objetLabel: string;
  montant: number;
  statut: StatutDemande;
  createdAt: Date;
}

/** Feuille "Demandes" de l'export — même ensemble que `getReportingRows`. */
export async function getReportingDemandesDetail(filters: ReportingFilters): Promise<ReportingDemandeDetail[]> {
  const { demandes } = await getDemandesFiltrees(filters);
  return demandes.map((d) => ({
    reference: d.reference,
    createurNom: d.createur.fullName,
    service: d.createur.service,
    categorieLabel: d.categorie?.label ?? "Non catégorisée",
    objetLabel: d.objet?.label ?? "Non renseigné",
    montant: Number(d.montant),
    statut: d.statut,
    createdAt: d.createdAt,
  }));
}

export interface ReportingReglementDetail {
  demandeReference: string;
  montant: number;
  mode: ModeReglement;
  confirmeLe: Date;
  auteurNom: string;
}

/** Feuille "Règlements" de l'export : règlements confirmés des demandes filtrées. */
export async function getReportingReglementsDetail(filters: ReportingFilters): Promise<ReportingReglementDetail[]> {
  const { demandes } = await getDemandesFiltrees(filters);
  const demandeIds = demandes.map((d) => d.id);
  if (demandeIds.length === 0) {
    return [];
  }
  const referenceParDemande = new Map(demandes.map((d) => [d.id, d.reference]));

  const reglements = await prisma.reglement.findMany({
    where: {
      demandeId: { in: demandeIds },
      estConfirme: true,
      estAnnule: false,
      ...(filters.mode ? { mode: filters.mode } : {}),
    },
    include: { auteur: true },
    orderBy: { confirmeAt: "asc" },
  });

  return reglements.map((r) => ({
    demandeReference: referenceParDemande.get(r.demandeId) ?? "—",
    montant: Number(r.montant),
    mode: r.mode,
    confirmeLe: r.confirmeAt ?? r.createdAt,
    auteurNom: r.auteur.fullName,
  }));
}

export interface ReportingRetourDetail {
  demandeReference: string;
  montantDepense: number;
  montantARetourner: number;
  justification: TypeJustification;
  estReceptionne: boolean;
  declareLe: Date;
}

/** Feuille "Retours de caisse" de l'export : retours liés aux demandes filtrées. */
export async function getReportingRetoursDetail(filters: ReportingFilters): Promise<ReportingRetourDetail[]> {
  const { demandes } = await getDemandesFiltrees(filters);
  const demandeIds = demandes.map((d) => d.id);
  if (demandeIds.length === 0) {
    return [];
  }
  const referenceParDemande = new Map(demandes.map((d) => [d.id, d.reference]));

  const retours = await prisma.retourCaisse.findMany({
    where: { reglement: { demandeId: { in: demandeIds } } },
    include: { reglement: true },
    orderBy: { createdAt: "asc" },
  });

  return retours.map((r) => ({
    demandeReference: referenceParDemande.get(r.reglement.demandeId) ?? "—",
    montantDepense: Number(r.montantDepense),
    montantARetourner: Number(r.montantARetourner),
    justification: r.justification,
    estReceptionne: r.estReceptionne,
    declareLe: r.createdAt,
  }));
}

export interface ReportingJournalDetail {
  type: string;
  montant: number;
  source: string;
  createdAt: Date;
}

/**
 * Feuille "Journal de caisse" de l'export : grand livre `JournalCaisse`,
 * filtré **uniquement par période** — la catégorie/l'objet/le mode n'ont
 * pas de sens à ce niveau (une écriture n'a pas de catégorie), demande
 * explicite du cahier des charges.
 */
export async function getReportingJournalDetail(filters: ReportingFilters): Promise<ReportingJournalDetail[]> {
  const entries = await prisma.journalCaisse.findMany({
    where: {
      ...(filters.du || filters.au
        ? { createdAt: { ...(filters.du ? { gte: filters.du } : {}), ...(filters.au ? { lte: filters.au } : {}) } }
        : {}),
    },
    orderBy: { createdAt: "asc" },
  });
  return entries.map((e) => ({
    type: e.type,
    montant: Number(e.montant),
    source: e.source,
    createdAt: e.createdAt,
  }));
}

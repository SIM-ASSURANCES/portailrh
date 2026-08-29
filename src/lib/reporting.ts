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
    statut: (["EN_ATTENTE", "VALIDEE", "REJETEE", "CLOTUREE_TOTALE", "CLOTUREE_PARTIELLE"] as const).includes(
      statut as StatutDemande
    )
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

/**
 * Montant réglé par demande (règlements confirmés, non annulés), groupé en
 * une seule requête — jamais une requête `getTotalRegle()` par demande. Si
 * `mode` est fourni, seuls les règlements de ce mode sont comptés : une
 * demande sans aucun règlement de ce mode n'apparaît alors pas dans la map
 * (utilisé ensuite pour l'exclure du reporting quand le filtre mode est actif).
 */
async function getMontantRegleParDemande(
  demandeIds: string[],
  mode?: ModeReglement
): Promise<Map<string, number>> {
  if (demandeIds.length === 0) {
    return new Map();
  }
  const sommes = await prisma.reglement.groupBy({
    by: ["demandeId"],
    where: { demandeId: { in: demandeIds }, estConfirme: true, estAnnule: false, ...(mode ? { mode } : {}) },
    _sum: { montant: true },
  });
  return new Map(sommes.map((s) => [s.demandeId, Number(s._sum.montant ?? 0)]));
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
 * mode) — fonction interne partagée par `getReportingRows` et
 * `getReportingDemandesDetail`, pour ne calculer cette liste qu'une fois
 * par appel et garantir que le tableau agrégé et le détail Excel désignent
 * toujours le même ensemble de demandes.
 */
async function getDemandesFiltrees(
  filters: ReportingFilters
): Promise<{ demandes: DemandeAvecRelations[]; montantRegleParDemande: Map<string, number> }> {
  const demandes = await prisma.demande.findMany({
    where: buildDemandeWhere(filters),
    include: { categorie: true, objet: true, createur: true },
    orderBy: { createdAt: "asc" },
  });

  const montantRegleParDemande = await getMontantRegleParDemande(
    demandes.map((d) => d.id),
    filters.mode
  );

  const demandesFiltrees = filters.mode ? demandes.filter((d) => montantRegleParDemande.has(d.id)) : demandes;

  return { demandes: demandesFiltrees, montantRegleParDemande };
}

export interface ReportingRow {
  categorieId: string | null;
  categorieLabel: string;
  objetId: string | null;
  objetLabel: string;
  nombreDemandes: number;
  montantDemande: number;
  montantRegle: number;
  /** null si aucune demande de ce groupe n'a de `budgetDisponible` renseigné. */
  budgetAlloue: number | null;
}

/**
 * Tableau agrégé par Catégorie puis Objet (Ticket 10, Tâche 1) : nombre de
 * demandes, montant total demandé, montant total réglé — plus le budget
 * alloué cumulé (Tâche 2, suivi budgétaire), calculés en mémoire à partir
 * d'une seule requête `findMany` + un seul `groupBy`, jamais une requête
 * par demande.
 */
export async function getReportingRows(filters: ReportingFilters): Promise<ReportingRow[]> {
  const { demandes, montantRegleParDemande } = await getDemandesFiltrees(filters);

  const buckets = new Map<string, ReportingRow>();
  for (const d of demandes) {
    const key = `${d.categorieId ?? "none"}|${d.objetId ?? "none"}`;
    const montantRegle = montantRegleParDemande.get(d.id) ?? 0;
    const budget = d.budgetDisponible != null ? Number(d.budgetDisponible) : null;

    const existing = buckets.get(key);
    if (existing) {
      existing.nombreDemandes += 1;
      existing.montantDemande += Number(d.montant);
      existing.montantRegle += montantRegle;
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
        montantRegle,
        budgetAlloue: budget,
      });
    }
  }

  return Array.from(buckets.values()).sort(
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

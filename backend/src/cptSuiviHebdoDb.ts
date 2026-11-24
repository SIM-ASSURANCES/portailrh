import type { Prisma, PrismaClient } from "./generated/prisma/client";
import { ageEnJoursCpt, dateLimiteAgeCpt, TAILLE_PAGE_SUIVI_CPT, type FiltresSuiviCpt } from "./cptSuiviHebdo";

/**
 * Accès base du contrôle hebdomadaire (lot GC-6) : LECTURE SEULE. Les deux listes de travail, leurs compteurs (indicateurs de
 * l'écran, lot GC-6c) et la sélection des lignes à relancer (GC-6b) passent TOUS par les deux filtres `where` ci-dessous : un
 * compteur et sa liste ne peuvent donc jamais diverger. Règles et âge : `cptSuiviHebdo.ts`.
 */
export type SuiviHebdoDbCpt = Pick<PrismaClient, "cptEncaissement" | "cptContrat" | "cptCompte" | "cptPartenaire">;

const jourEnDate = (jour: string) => new Date(`${jour}T00:00:00Z`);

/**
 * Encaissements sans contrat : un crédit dont une part reste à rattacher. `A_RATTACHER` est le statut du rapprochement (GC-5) : il ne
 * passe à `SOLDE` qu'à la VALIDATION d'un rattachement (RG-01), donc une proposition seulement faite ou confirmée laisse la ligne ici.
 * `ageMinJours` : au moins ce nombre de jours depuis la date de valeur.
 */
export function encaissementsSansContratWhere(filtres: FiltresSuiviCpt, maintenant: Date, ageMinJours?: number): Prisma.CptEncaissementWhereInput {
  const fin = [filtres.au, ageMinJours !== undefined ? dateLimiteAgeCpt(maintenant, ageMinJours) : null].filter((j): j is string => j !== null).sort()[0];
  return {
    typeFlux: "ENCAISSEMENT",
    statut: "A_RATTACHER",
    resteARattacher: { gt: 0 },
    ...(filtres.compteId ? { compteId: filtres.compteId } : {}),
    ...(filtres.du || fin ? { dateValeur: { ...(filtres.du ? { gte: jourEnDate(filtres.du) } : {}), ...(fin ? { lte: jourEnDate(fin) } : {}) } } : {}),
  };
}

/**
 * Contrats déclarés payés sans encaissement : la production dit « payé » (`declarePaye`) et aucune échéance du contrat n'a de
 * rattachement proposé, confirmé ou validé (un rattachement REJETÉ ne compte pas). Un contrat annulé est écarté : il n'a jamais été
 * en vigueur. La date d'âge est la date de paiement déclarée, à défaut la date de création du contrat (import).
 */
export function contratsSansEncaissementWhere(filtres: FiltresSuiviCpt, maintenant: Date, ageMinJours?: number): Prisma.CptContratWhereInput {
  const fin = [filtres.au, ageMinJours !== undefined ? dateLimiteAgeCpt(maintenant, ageMinJours) : null].filter((j): j is string => j !== null).sort()[0];
  const conditions: Prisma.CptContratWhereInput[] = [];
  if (filtres.du) conditions.push({ OR: [{ datePaiementDeclaree: { gte: jourEnDate(filtres.du) } }, { datePaiementDeclaree: null, creeAt: { gte: jourEnDate(filtres.du) } }] });
  if (fin) {
    const apresFin = new Date(jourEnDate(fin).getTime() + 86_400_000);
    conditions.push({ OR: [{ datePaiementDeclaree: { lte: jourEnDate(fin) } }, { datePaiementDeclaree: null, creeAt: { lt: apresFin } }] });
  }
  return {
    declarePaye: true,
    statut: { not: "ANNULE" },
    echeances: { none: { rattachements: { some: { statut: { in: ["PROPOSE", "CONFIRME", "VALIDE"] } } } } },
    ...(filtres.partenaireId ? { partenaireApporteurId: filtres.partenaireId } : {}),
    ...(filtres.branche ? { produit: { branche: filtres.branche } } : {}),
    ...(conditions.length > 0 ? { AND: conditions } : {}),
  };
}

export interface LigneEncaissementSansContratCpt {
  id: string;
  reference: string;
  compteLibelle: string;
  dateValeur: Date;
  age: number;
  payeur: string | null;
  telephone: string | null;
  referenceClient: string | null;
  montant: string;
  resteARattacher: string;
  /** Une proposition de rattachement attend déjà une confirmation ou une validation. */
  propositionEnCours: boolean;
}

export interface LigneContratSansEncaissementCpt {
  id: string;
  numPolice: string;
  clientNom: string;
  partenaireNom: string | null;
  produitLibelle: string;
  branche: string;
  referencePaiementDeclaree: string | null;
  datePaiement: Date;
  /** `true` quand la date d'âge est la date d'import du contrat (aucune date de paiement déclarée). */
  dateParDefaut: boolean;
  age: number;
  primeTtc: string;
}

export function dateAgeContratCpt(c: { datePaiementDeclaree: Date | null; creeAt: Date }): Date {
  return c.datePaiementDeclaree ?? c.creeAt;
}

export async function listerEncaissementsSansContratCpt(
  db: SuiviHebdoDbCpt,
  filtres: FiltresSuiviCpt,
  maintenant: Date,
  page: number
): Promise<{ total: number; lignes: LigneEncaissementSansContratCpt[] }> {
  const where = encaissementsSansContratWhere(filtres, maintenant);
  const [total, lignes] = await Promise.all([
    db.cptEncaissement.count({ where }),
    db.cptEncaissement.findMany({
      where,
      orderBy: [{ dateValeur: "asc" }, { reference: "asc" }],
      skip: (page - 1) * TAILLE_PAGE_SUIVI_CPT,
      take: TAILLE_PAGE_SUIVI_CPT,
      select: {
        id: true,
        reference: true,
        dateValeur: true,
        payeur: true,
        telephone: true,
        referenceClient: true,
        montant: true,
        resteARattacher: true,
        compte: { select: { libelle: true } },
        rattachements: { where: { statut: { in: ["PROPOSE", "CONFIRME"] } }, select: { id: true }, take: 1 },
      },
    }),
  ]);
  return {
    total,
    lignes: lignes.map((e) => ({
      id: e.id,
      reference: e.reference,
      compteLibelle: e.compte.libelle,
      dateValeur: e.dateValeur,
      age: ageEnJoursCpt(e.dateValeur, maintenant),
      payeur: e.payeur,
      telephone: e.telephone,
      referenceClient: e.referenceClient,
      montant: e.montant.toString(),
      resteARattacher: e.resteARattacher.toString(),
      propositionEnCours: e.rattachements.length > 0,
    })),
  };
}

export async function listerContratsSansEncaissementCpt(
  db: SuiviHebdoDbCpt,
  filtres: FiltresSuiviCpt,
  maintenant: Date,
  page: number
): Promise<{ total: number; lignes: LigneContratSansEncaissementCpt[] }> {
  const where = contratsSansEncaissementWhere(filtres, maintenant);
  const [total, contrats] = await Promise.all([
    db.cptContrat.count({ where }),
    db.cptContrat.findMany({
      where,
      // Plus anciens d'abord selon la date de paiement déclarée ; les contrats sans date déclarée (âge calculé depuis leur import) viennent
      // ensuite, par date d'import : Prisma ne sait pas trier sur « date déclarée, à défaut date d'import ».
      orderBy: [{ datePaiementDeclaree: { sort: "asc", nulls: "last" } }, { creeAt: "asc" }, { numPolice: "asc" }],
      skip: (page - 1) * TAILLE_PAGE_SUIVI_CPT,
      take: TAILLE_PAGE_SUIVI_CPT,
      select: {
        id: true,
        numPolice: true,
        referencePaiementDeclaree: true,
        datePaiementDeclaree: true,
        creeAt: true,
        primeTtc: true,
        client: { select: { nom: true } },
        partenaireApporteur: { select: { nom: true } },
        produit: { select: { libelle: true, branche: true } },
      },
    }),
  ]);
  return {
    total,
    lignes: contrats.map((c) => {
      const date = dateAgeContratCpt(c);
      return {
        id: c.id,
        numPolice: c.numPolice,
        clientNom: c.client.nom,
        partenaireNom: c.partenaireApporteur?.nom ?? null,
        produitLibelle: c.produit.libelle,
        branche: c.produit.branche,
        referencePaiementDeclaree: c.referencePaiementDeclaree,
        datePaiement: date,
        dateParDefaut: c.datePaiementDeclaree === null,
        age: ageEnJoursCpt(date, maintenant),
        primeTtc: c.primeTtc.toString(),
      };
    }),
  };
}

/** Compteurs des indicateurs : MÊMES filtres que les listes, avec un âge minimum. */
export async function compterEncaissementsSansContratCpt(db: SuiviHebdoDbCpt, filtres: FiltresSuiviCpt, maintenant: Date, ageMinJours?: number): Promise<number> {
  return db.cptEncaissement.count({ where: encaissementsSansContratWhere(filtres, maintenant, ageMinJours) });
}

export async function compterContratsSansEncaissementCpt(db: SuiviHebdoDbCpt, filtres: FiltresSuiviCpt, maintenant: Date, ageMinJours?: number): Promise<number> {
  return db.cptContrat.count({ where: contratsSansEncaissementWhere(filtres, maintenant, ageMinJours) });
}

export interface OptionsFiltresSuiviCpt {
  comptes: { id: string; libelle: string }[];
  partenaires: { id: string; nom: string }[];
}

export async function chargerOptionsFiltresSuiviCpt(db: SuiviHebdoDbCpt): Promise<OptionsFiltresSuiviCpt> {
  const [comptes, partenaires] = await Promise.all([
    db.cptCompte.findMany({ orderBy: { libelle: "asc" }, select: { id: true, libelle: true } }),
    db.cptPartenaire.findMany({ orderBy: { nom: "asc" }, select: { id: true, nom: true } }),
  ]);
  return { comptes, partenaires };
}

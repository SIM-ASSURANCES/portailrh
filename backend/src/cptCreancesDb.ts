import type { Prisma, PrismaClient } from "./generated/prisma/client";
import {
  debiteurDuContratCpt,
  HORIZON_ECHEANCES_JOURS_CPT,
  regrouperParDebiteurCpt,
  repartitionParTrancheCpt,
  syntheseContratCreanceCpt,
  type ContratPourCreanceCpt,
  type DebiteurCreanceCpt,
  type FiltresCreancesCpt,
  type RepartitionTrancheCpt,
} from "./cptCreances";
import { ajouterJoursCpt, etatAfficheEcheance, type EtatAfficheEcheance, texteDepuisCentimes } from "./cptEcheancier";
import { RECHERCHE_LIMITE_MAX_CPT, rechercherCpt } from "./cptRecherche";

/**
 * État des créances et échéances proches (lot GC-7b) : LECTURE SEULE. Les chiffres d'un contrat viennent de `syntheseContratCreanceCpt`
 * (`cptCreances.ts`), le même calcul que la fiche client : jamais un second calcul. Encaissé prouvé = `montantRegle` (rattachements validés).
 */
export type CreancesDbCpt = Pick<PrismaClient, "cptContrat" | "cptEcheance" | "cptPartenaire" | "$queryRaw">;

export const TAILLE_PAGE_ECHEANCES_CPT = 50;
export const TAILLE_PAGE_DEBITEURS_CPT = 50;

/** Clients correspondant à la recherche libre ; `null` = pas de filtre client. Aucun mot trouvé = liste vide (jamais « tout »). */
async function clientsDeLaRecherche(db: CreancesDbCpt, q: string): Promise<string[] | null> {
  if (!q) return null;
  const trouves = await rechercherCpt(db, q, { entite: "CLIENT", limite: RECHERCHE_LIMITE_MAX_CPT });
  return trouves.map((t) => t.entiteId);
}

async function filtreContrat(db: CreancesDbCpt, f: FiltresCreancesCpt): Promise<Prisma.CptContratWhereInput> {
  const clients = await clientsDeLaRecherche(db, f.q);
  return {
    statut: { not: "ANNULE" },
    ...(clients !== null ? { clientId: { in: clients } } : {}),
    ...(f.partenaireId ? { partenaireApporteurId: f.partenaireId } : {}),
  };
}

export interface EtatCreancesCpt {
  /** Tous les débiteurs filtrés (la page découpe). */
  debiteurs: DebiteurCreanceCpt[];
  repartition: RepartitionTrancheCpt[];
  totaux: { resteDu: bigint; resteEchu: bigint; resteEnRetard: bigint; declarePayeNonProuve: bigint; nbDebiteurs: number };
}

/** État des créances par débiteur. Filtres : client (recherche), partenaire apporteur, tranche (appliquée sur le débiteur regroupé). */
export async function chargerEtatCreancesCpt(db: CreancesDbCpt, f: FiltresCreancesCpt, aujourdhui: string): Promise<EtatCreancesCpt> {
  const where = { ...(await filtreContrat(db, f)), echeances: { some: { etat: "OUVERTE" as const } } };
  const contrats = await db.cptContrat.findMany({
    where,
    select: {
      id: true,
      numPolice: true,
      statut: true,
      declarePaye: true,
      client: { select: { id: true, nom: true } },
      partenaireApporteur: { select: { id: true, nom: true, estClient: true } },
      produit: { select: { libelle: true } },
      echeances: { select: { rang: true, etat: true, datePrevue: true, montantDu: true, montantRegle: true } },
    },
  });
  const lignes: ContratPourCreanceCpt[] = contrats.map((c) => ({
    contratId: c.id,
    numPolice: c.numPolice,
    clientId: c.client.id,
    clientNom: c.client.nom,
    apporteurId: c.partenaireApporteur?.id ?? null,
    apporteurNom: c.partenaireApporteur?.nom ?? null,
    produitLibelle: c.produit.libelle,
    debiteur: debiteurDuContratCpt({ client: c.client, apporteur: c.partenaireApporteur }),
    synthese: syntheseContratCreanceCpt(
      {
        statut: c.statut,
        declarePaye: c.declarePaye,
        echeances: c.echeances.map((e) => ({ rang: e.rang, etat: e.etat, datePrevue: e.datePrevue.toISOString().slice(0, 10), montantDu: e.montantDu.toString(), montantRegle: e.montantRegle.toString() })),
      },
      aujourdhui
    ),
  }));
  const tous = regrouperParDebiteurCpt(lignes);
  const debiteurs = f.tranche ? tous.filter((d) => d.tranche === f.tranche) : tous;
  const zero = BigInt(0);
  return {
    debiteurs,
    repartition: repartitionParTrancheCpt(tous),
    totaux: {
      resteDu: debiteurs.reduce((s, d) => s + d.resteDu, zero),
      resteEchu: debiteurs.reduce((s, d) => s + d.resteEchu, zero),
      resteEnRetard: debiteurs.reduce((s, d) => s + d.resteEnRetard, zero),
      declarePayeNonProuve: debiteurs.reduce((s, d) => s + d.declarePayeNonProuve, zero),
      nbDebiteurs: debiteurs.length,
    },
  };
}

// ---------- Échéances dues dans les 7 jours et en retard ----------

export interface EcheanceProcheCpt {
  id: string;
  numPolice: string;
  clientId: string;
  clientNom: string;
  partenaireNom: string | null;
  rang: number;
  datePrevue: Date;
  montantDu: string;
  montantRegle: string;
  resteDu: string;
  etat: EtatAfficheEcheance;
  libelleEtat: string;
  joursRetard: number;
}

/**
 * Filtre des échéances : une échéance OUVERTE (reste > 0) d'un contrat non annulé, prévue au plus tard dans 7 jours. Vue « en retard » = date
 * strictement dépassée ; « dues dans 7 jours » = aujourd'hui compris jusqu'à J+7.
 */
export async function echeancesProchesWhereCpt(db: CreancesDbCpt, f: FiltresCreancesCpt, aujourdhui: string): Promise<Prisma.CptEcheanceWhereInput> {
  const fin = new Date(`${ajouterJoursCpt(aujourdhui, HORIZON_ECHEANCES_JOURS_CPT)}T00:00:00Z`);
  const jour = new Date(`${aujourdhui}T00:00:00Z`);
  const datePrevue = f.vue === "EN_RETARD" ? { lt: jour } : f.vue === "DUES_7J" ? { gte: jour, lte: fin } : { lte: fin };
  return { etat: "OUVERTE", datePrevue, contrat: await filtreContrat(db, f) };
}

const SELECTION_ECHEANCE = {
  id: true,
  rang: true,
  datePrevue: true,
  etat: true,
  montantDu: true,
  montantRegle: true,
  contrat: { select: { numPolice: true, client: { select: { id: true, nom: true } }, partenaireApporteur: { select: { nom: true } } } },
} as const;

function versEcheanceProche(e: Prisma.CptEcheanceGetPayload<{ select: typeof SELECTION_ECHEANCE }>, aujourdhui: string): EcheanceProcheCpt {
  const etat = etatAfficheEcheance({ etat: e.etat, datePrevue: e.datePrevue.toISOString().slice(0, 10), montantDu: e.montantDu.toString(), montantRegle: e.montantRegle.toString() }, aujourdhui);
  return {
    id: e.id,
    numPolice: e.contrat.numPolice,
    clientId: e.contrat.client.id,
    clientNom: e.contrat.client.nom,
    partenaireNom: e.contrat.partenaireApporteur?.nom ?? null,
    rang: e.rang,
    datePrevue: e.datePrevue,
    montantDu: e.montantDu.toString(),
    montantRegle: e.montantRegle.toString(),
    resteDu: texteDepuisCentimes(etat.resteDu),
    etat: etat.etat,
    libelleEtat: etat.libelle,
    joursRetard: etat.joursRetard,
  };
}

const ORDRE_ECHEANCES = [{ datePrevue: "asc" as const }, { id: "asc" as const }];

export async function listerEcheancesProchesCpt(db: CreancesDbCpt, f: FiltresCreancesCpt, aujourdhui: string, page: number): Promise<{ total: number; lignes: EcheanceProcheCpt[] }> {
  const where = await echeancesProchesWhereCpt(db, f, aujourdhui);
  const [total, lignes] = await Promise.all([
    db.cptEcheance.count({ where }),
    db.cptEcheance.findMany({ where, orderBy: ORDRE_ECHEANCES, skip: (Math.max(1, page) - 1) * TAILLE_PAGE_ECHEANCES_CPT, take: TAILLE_PAGE_ECHEANCES_CPT, select: SELECTION_ECHEANCE }),
  ]);
  return { total, lignes: lignes.map((e) => versEcheanceProche(e, aujourdhui)) };
}

/** Toutes les échéances du filtre, par lots (export en flux : la mémoire reste bornée). */
export async function* parcourirEcheancesProchesCpt(db: CreancesDbCpt, f: FiltresCreancesCpt, aujourdhui: string): AsyncGenerator<EcheanceProcheCpt> {
  const where = await echeancesProchesWhereCpt(db, f, aujourdhui);
  let curseur: string | undefined;
  for (;;) {
    const lot = await db.cptEcheance.findMany({
      where,
      orderBy: ORDRE_ECHEANCES,
      take: 1000,
      ...(curseur ? { cursor: { id: curseur }, skip: 1 } : {}),
      select: SELECTION_ECHEANCE,
    });
    if (lot.length === 0) return;
    for (const e of lot) yield versEcheanceProche(e, aujourdhui);
    curseur = lot[lot.length - 1].id;
    if (lot.length < 1000) return;
  }
}

/** Partenaires proposés par le filtre (apporteurs actifs ou déjà utilisés). */
export async function listerPartenairesFiltreCreancesCpt(db: Pick<PrismaClient, "cptPartenaire">): Promise<{ id: string; nom: string }[]> {
  return db.cptPartenaire.findMany({ where: { OR: [{ estApporteur: true }, { estClient: true }] }, orderBy: { nom: "asc" }, select: { id: true, nom: true } });
}

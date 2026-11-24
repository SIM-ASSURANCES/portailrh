import type { PrismaClient } from "./generated/prisma/client";
import { etatAfficheEcheance, texteDepuisCentimes, type EtatAfficheEcheance } from "./cptEcheancier";
import { syntheseContratCreanceCpt, type SyntheseContratCreanceCpt } from "./cptCreances";
import { RECHERCHE_LIMITE_MAX_CPT, rechercherCpt } from "./cptRecherche";

/**
 * Fiche client (lot GC-7a) : LECTURE SEULE. Aucun chiffre n'est recalculé ici : les échéances viennent de GC-3, l'encaissé prouvé
 * est `CptEcheance.montantRegle` (tenu par `cptRattachement.ts` à la validation d'un rattachement) et les paiements listés sont les
 * rattachements eux-mêmes. Un rattachement seulement proposé ou confirmé n'est PAS un paiement prouvé (RG-01) : il figure à part,
 * « en attente de validation ».
 */
export type FicheClientDbCpt = Pick<PrismaClient, "cptClient" | "cptContrat" | "cptRattachement" | "$queryRaw">;

export interface EcheanceFicheCpt {
  id: string;
  rang: number;
  datePrevue: Date;
  montantDu: string;
  montantRegle: string;
  etat: EtatAfficheEcheance;
  libelleEtat: string;
  joursRetard: number;
  resteDu: string;
}

export interface ContratFicheCpt {
  id: string;
  numPolice: string;
  statut: string;
  produitLibelle: string;
  branche: string;
  partenaireNom: string | null;
  dateEffet: Date;
  dateEcheance: Date;
  fractionnement: string;
  primeTtc: string;
  declarePaye: boolean;
  synthese: SyntheseContratCreanceCpt;
  echeances: EcheanceFicheCpt[];
}

export interface PaiementFicheCpt {
  rattachementId: string;
  encaissementReference: string;
  referenceReleve: string;
  canal: string;
  compteLibelle: string;
  dateValeur: Date;
  montant: string;
  numPolice: string;
  rangEcheance: number;
  statut: string;
}

export interface SommePasUnePrimeCpt {
  encaissementReference: string;
  dateValeur: Date;
  montant: string;
  motif: string | null;
}

export interface FicheClientCpt {
  client: { id: string; nom: string; telephone: string | null; pieceIdentite: string | null; partenaireOrigine: string | null; creeAt: Date };
  contrats: ContratFicheCpt[];
  /** Rattachements VALIDÉS : l'argent prouvé, du plus récent au plus ancien. */
  paiements: PaiementFicheCpt[];
  /** Rattachements proposés ou confirmés, pas encore validés par le RFCRH : jamais comptés comme payés. */
  paiementsEnAttente: PaiementFicheCpt[];
  /** Part « pas une prime » des encaissements dont une partie est rattachée à ce client (RG-03 : motif écrit). */
  sommesPasUnePrime: SommePasUnePrimeCpt[];
  totaux: { primeEmise: string; encaisseProuve: string; resteDu: string; resteEnRetard: string; declarePayeNonProuve: string; nbEcheancesEnRetard: number; tranche: SyntheseContratCreanceCpt["tranche"]; joursAnciennete: number | null; depuisLe: string | null };
}

const jourTexte = (d: Date) => d.toISOString().slice(0, 10);

/** Charge la fiche d'un client, ou `null` s'il n'existe pas. `aujourdhui` : AAAA-MM-JJ. */
export async function chargerFicheClientCpt(db: FicheClientDbCpt, clientId: string, aujourdhui: string): Promise<FicheClientCpt | null> {
  const client = await db.cptClient.findUnique({
    where: { id: clientId },
    include: {
      partenaireOrigine: { select: { nom: true } },
      contrats: {
        orderBy: [{ dateEffet: "desc" }, { numPolice: "asc" }],
        include: {
          produit: { select: { libelle: true, branche: true } },
          partenaireApporteur: { select: { nom: true } },
          echeances: { orderBy: { rang: "asc" } },
        },
      },
    },
  });
  if (!client) return null;

  const contrats: ContratFicheCpt[] = client.contrats.map((c) => {
    const echeances: EcheanceFicheCpt[] = c.echeances.map((e) => {
      const etat = etatAfficheEcheance({ etat: e.etat, datePrevue: jourTexte(e.datePrevue), montantDu: e.montantDu.toString(), montantRegle: e.montantRegle.toString() }, aujourdhui);
      return {
        id: e.id,
        rang: e.rang,
        datePrevue: e.datePrevue,
        montantDu: e.montantDu.toString(),
        montantRegle: e.montantRegle.toString(),
        etat: etat.etat,
        libelleEtat: etat.libelle,
        joursRetard: etat.joursRetard,
        resteDu: texteDepuisCentimes(etat.resteDu),
      };
    });
    const synthese = syntheseContratCreanceCpt(
      {
        statut: c.statut,
        declarePaye: c.declarePaye,
        echeances: c.echeances.map((e) => ({ rang: e.rang, etat: e.etat, datePrevue: jourTexte(e.datePrevue), montantDu: e.montantDu.toString(), montantRegle: e.montantRegle.toString() })),
      },
      aujourdhui
    );
    return {
      id: c.id,
      numPolice: c.numPolice,
      statut: c.statut,
      produitLibelle: c.produit.libelle,
      branche: c.produit.branche,
      partenaireNom: c.partenaireApporteur?.nom ?? null,
      dateEffet: c.dateEffet,
      dateEcheance: c.dateEcheance,
      fractionnement: c.fractionnement,
      primeTtc: c.primeTtc.toString(),
      declarePaye: c.declarePaye,
      synthese,
      echeances,
    };
  });

  const echeanceIds = client.contrats.flatMap((c) => c.echeances.map((e) => e.id));
  const rattachements = echeanceIds.length
    ? await db.cptRattachement.findMany({
        where: { echeanceId: { in: echeanceIds }, statut: { in: ["VALIDE", "PROPOSE", "CONFIRME"] } },
        orderBy: [{ encaissement: { dateValeur: "desc" } }, { creeAt: "desc" }],
        include: {
          encaissement: { select: { reference: true, referenceReleve: true, dateValeur: true, montantPasUnePrime: true, motifPasUnePrime: true, compte: { select: { libelle: true, type: true } } } },
          echeance: { select: { rang: true, contrat: { select: { numPolice: true } } } },
        },
      })
    : [];
  const versPaiement = (r: (typeof rattachements)[number]): PaiementFicheCpt => ({
    rattachementId: r.id,
    encaissementReference: r.encaissement.reference,
    referenceReleve: r.encaissement.referenceReleve,
    canal: r.encaissement.compte.type,
    compteLibelle: r.encaissement.compte.libelle,
    dateValeur: r.encaissement.dateValeur,
    montant: r.montant.toString(),
    numPolice: r.echeance.contrat.numPolice,
    rangEcheance: r.echeance.rang,
    statut: r.statut,
  });
  const paiements = rattachements.filter((r) => r.statut === "VALIDE").map(versPaiement);
  const paiementsEnAttente = rattachements.filter((r) => r.statut !== "VALIDE").map(versPaiement);

  // « Pas une prime » : une ligne par encaissement (jamais par rattachement), pour ceux dont une part est rattachée à ce client.
  const vus = new Set<string>();
  const sommesPasUnePrime: SommePasUnePrimeCpt[] = [];
  for (const r of rattachements) {
    if (vus.has(r.encaissement.reference) || r.encaissement.montantPasUnePrime.toString() === "0") continue;
    vus.add(r.encaissement.reference);
    sommesPasUnePrime.push({ encaissementReference: r.encaissement.reference, dateValeur: r.encaissement.dateValeur, montant: r.encaissement.montantPasUnePrime.toString(), motif: r.encaissement.motifPasUnePrime });
  }

  let primeEmise = BigInt(0);
  let encaisseProuve = BigInt(0);
  let resteDu = BigInt(0);
  let resteEnRetard = BigInt(0);
  let declarePayeNonProuve = BigInt(0);
  let nbEcheancesEnRetard = 0;
  let depuisLe: string | null = null;
  for (const c of contrats) {
    primeEmise += c.synthese.primeEmise;
    encaisseProuve += c.synthese.encaisseProuve;
    resteDu += c.synthese.resteDu;
    resteEnRetard += c.synthese.resteEnRetard;
    declarePayeNonProuve += c.synthese.declarePayeNonProuve;
    nbEcheancesEnRetard += c.synthese.nbEcheancesEnRetard;
    if (c.synthese.depuisLe && (depuisLe === null || c.synthese.depuisLe < depuisLe)) depuisLe = c.synthese.depuisLe;
  }
  const anciennete = contrats.map((c) => c.synthese).filter((s) => s.depuisLe === depuisLe && depuisLe !== null)[0] ?? null;
  return {
    client: {
      id: client.id,
      nom: client.nom,
      telephone: client.telephone,
      pieceIdentite: client.pieceIdentite,
      partenaireOrigine: client.partenaireOrigine?.nom ?? null,
      creeAt: client.creeAt,
    },
    contrats,
    paiements,
    paiementsEnAttente,
    sommesPasUnePrime,
    totaux: {
      primeEmise: texteDepuisCentimes(primeEmise),
      encaisseProuve: texteDepuisCentimes(encaisseProuve),
      resteDu: texteDepuisCentimes(resteDu),
      resteEnRetard: texteDepuisCentimes(resteEnRetard),
      declarePayeNonProuve: texteDepuisCentimes(declarePayeNonProuve),
      nbEcheancesEnRetard,
      tranche: anciennete?.tranche ?? null,
      joursAnciennete: anciennete?.joursAnciennete ?? null,
      depuisLe,
    },
  };
}

// ---------- Recherche de clients (index de mots) ----------

export interface ClientTrouveCpt {
  id: string;
  nom: string;
  telephone: string | null;
  partenaireOrigine: string | null;
  nbContrats: number;
}

export const TAILLE_PAGE_CLIENTS_CPT = 50;

/**
 * Liste de clients par page, du plus récent au plus ancien ; avec `saisie`, recherche par DÉBUT DE MOT dans l'index existant
 * (`CptMot`, entité CLIENT, mêmes règles que « Référentiels » : plusieurs mots en ET, 6 mots au plus).
 */
export async function listerClientsCpt(db: FicheClientDbCpt, saisie: string, page: number): Promise<{ total: number; clients: ClientTrouveCpt[] }> {
  const trouves = saisie.trim() ? await rechercherCpt(db, saisie, { entite: "CLIENT", limite: RECHERCHE_LIMITE_MAX_CPT }) : null;
  const ids = trouves === null ? null : trouves.map((t) => t.entiteId);
  const where = ids === null ? {} : { id: { in: ids } };
  const [total, lignes] = await Promise.all([
    db.cptClient.count({ where }),
    db.cptClient.findMany({
      where,
      orderBy: [{ creeAt: "desc" }, { nom: "asc" }],
      skip: (Math.max(1, page) - 1) * TAILLE_PAGE_CLIENTS_CPT,
      take: TAILLE_PAGE_CLIENTS_CPT,
      select: { id: true, nom: true, telephone: true, partenaireOrigine: { select: { nom: true } }, _count: { select: { contrats: true } } },
    }),
  ]);
  return { total, clients: lignes.map((c) => ({ id: c.id, nom: c.nom, telephone: c.telephone, partenaireOrigine: c.partenaireOrigine?.nom ?? null, nbContrats: c._count.contrats })) };
}

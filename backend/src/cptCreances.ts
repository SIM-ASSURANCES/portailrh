// Gestion Compta, lot GC-7 — créances et ancienneté (docs/compta-conception.md §6.5, règle C-5). MOTEUR PUR : aucune base, aucune horloge
// (la date du jour est un paramètre, au format AAAA-MM-JJ, jour civil du serveur). Les montants sont des centimes entiers (`bigint`).
//
// UNE SEULE source de chaque chiffre (jamais un second calcul) :
//  - l'ENCAISSÉ PROUVÉ d'une échéance est `montantRegle`, recalculé à chaque validation de rattachement par `cptRattachement.ts`
//    (somme des rattachements VALIDE, RG-01) ; le « déclaré payé » de la production n'est jamais une preuve ;
//  - les échéances (montant dû, date prévue, état) viennent de GC-3 ; l'état affiché et le reste dû reprennent `cptEcheancier.ts`.

import { enCentimesEcheancier, etatAfficheEcheance, joursEntreCpt, type EtatBaseEcheance, type MontantEntreeCpt } from "./cptEcheancier";

const ZERO = BigInt(0);

// ---------- Tranches d'ancienneté (C-5) ----------

export const TRANCHES_CREANCE_CPT = ["T0_30", "T31_90", "T91_180", "PLUS_180"] as const;
export type TrancheCreanceCpt = (typeof TRANCHES_CREANCE_CPT)[number];

export const LIBELLE_TRANCHE_CREANCE_CPT: Record<TrancheCreanceCpt, string> = {
  T0_30: "0 à 30 jours",
  T31_90: "31 à 90 jours",
  T91_180: "91 à 180 jours",
  PLUS_180: "Plus de 180 jours",
};

/** Tranche d'un nombre de jours d'ancienneté : 0–30, 31–90, 91–180, plus de 180 (bornes incluses côté bas de chaque tranche). */
export function trancheCreanceCpt(jours: number): TrancheCreanceCpt {
  if (jours <= 30) return "T0_30";
  if (jours <= 90) return "T31_90";
  if (jours <= 180) return "T91_180";
  return "PLUS_180";
}

// ---------- Synthèse d'un contrat ----------

export interface EcheanceCreanceCpt {
  rang: number;
  etat: EtatBaseEcheance;
  /** AAAA-MM-JJ */
  datePrevue: string;
  montantDu: MontantEntreeCpt;
  montantRegle: MontantEntreeCpt;
}

export interface ContratCreanceEntreeCpt {
  /** Statut du contrat : un contrat ANNULÉ n'est pas une dette (jamais en vigueur), il est écarté. */
  statut: string;
  /** Ce que la production DÉCLARE : jamais une preuve d'encaissement. */
  declarePaye: boolean;
  echeances: readonly EcheanceCreanceCpt[];
}

export interface SyntheseContratCreanceCpt {
  /** Somme des montants dus des échéances non annulées (la prime du contrat, échéancier complet). */
  primeEmise: bigint;
  /** Somme des montants réglés prouvés (rattachements validés). */
  encaisseProuve: bigint;
  /** Ce qu'il reste à payer sur TOUT l'échéancier (échu ou non) : T12 = 10 × 506 486. */
  resteDu: bigint;
  /** Part du reste dû dont l'échéance est ÉCHUE (date prévue ≤ aujourd'hui) : la dette exigible. */
  resteEchu: bigint;
  /** Part du reste dû dont l'échéance est en retard (date prévue < aujourd'hui, strictement). */
  resteEnRetard: bigint;
  /** Reste dû sur un contrat que la production déclare payé : l'affirmation n'est pas prouvée. Inclus dans `resteDu`, jamais en plus. */
  declarePayeNonProuve: bigint;
  /** Date prévue de la plus ancienne échéance impayée et échue (C-5) ; nul s'il n'y en a pas. */
  depuisLe: string | null;
  /** Jours entre cette date et aujourd'hui (0 si l'échéance tombe aujourd'hui) ; nul s'il n'y en a pas. */
  joursAnciennete: number | null;
  tranche: TrancheCreanceCpt | null;
  /** Nombre d'échéances en retard (date prévue dépassée, reste > 0). */
  nbEcheancesEnRetard: number;
}

export const SYNTHESE_CONTRAT_VIDE_CPT: SyntheseContratCreanceCpt = {
  primeEmise: ZERO,
  encaisseProuve: ZERO,
  resteDu: ZERO,
  resteEchu: ZERO,
  resteEnRetard: ZERO,
  declarePayeNonProuve: ZERO,
  depuisLe: null,
  joursAnciennete: null,
  tranche: null,
  nbEcheancesEnRetard: 0,
};

/**
 * Synthèse d'un contrat à la date `aujourdhui`. Ancienneté (C-5) : depuis la DATE PRÉVUE de la plus ancienne échéance impayée ET échue
 * — jamais la date de saisie ni celle de l'import. Une échéance non encore échue n'est pas une dette en retard (elle compte dans le
 * reste dû et pas dans le reste échu). Aucune taxe n'est exigible sur ce reste dû (GC-8 la traitera à l'encaissement).
 */
export function syntheseContratCreanceCpt(contrat: ContratCreanceEntreeCpt, aujourdhui: string): SyntheseContratCreanceCpt {
  if (contrat.statut === "ANNULE") return SYNTHESE_CONTRAT_VIDE_CPT;
  let primeEmise = ZERO;
  let encaisseProuve = ZERO;
  let resteDu = ZERO;
  let resteEchu = ZERO;
  let resteEnRetard = ZERO;
  let depuisLe: string | null = null;
  let nbEcheancesEnRetard = 0;
  for (const e of contrat.echeances) {
    if (e.etat === "ANNULEE") continue;
    const du = enCentimesEcheancier(e.montantDu) ?? ZERO;
    const regle = enCentimesEcheancier(e.montantRegle) ?? ZERO;
    primeEmise += du;
    encaisseProuve += regle;
    const etat = etatAfficheEcheance(e, aujourdhui);
    if (etat.resteDu === ZERO) continue;
    resteDu += etat.resteDu;
    if (e.datePrevue <= aujourdhui) {
      resteEchu += etat.resteDu;
      if (depuisLe === null || e.datePrevue < depuisLe) depuisLe = e.datePrevue;
    }
    if (e.datePrevue < aujourdhui) {
      resteEnRetard += etat.resteDu;
      nbEcheancesEnRetard++;
    }
  }
  const joursAnciennete = depuisLe === null ? null : joursEntreCpt(depuisLe, aujourdhui);
  return {
    primeEmise,
    encaisseProuve,
    resteDu,
    resteEchu,
    resteEnRetard,
    declarePayeNonProuve: contrat.declarePaye ? resteDu : ZERO,
    depuisLe,
    joursAnciennete,
    tranche: joursAnciennete === null ? null : trancheCreanceCpt(joursAnciennete),
    nbEcheancesEnRetard,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Par débiteur (lot GC-7b)
// ---------------------------------------------------------------------------------------------------------------------

export type TypeDebiteurCpt = "CLIENT" | "PARTENAIRE";

export interface DebiteurCpt {
  /** Clé stable : « CLIENT:<id> » ou « PARTENAIRE:<id> ». */
  cle: string;
  type: TypeDebiteurCpt;
  id: string;
  nom: string;
}

/**
 * Qui doit l'argent (règle C-20, PROVISOIRE, question Q18) : un partenaire apporteur qui est aussi CLIENT (`estClient`) paie pour ses
 * clients, il est donc le débiteur de leurs contrats ; sinon le débiteur est le client du contrat (client direct). Le modèle ne dit pas
 * autrement qui paie : un partenaire qui n'est pas marqué client n'est jamais débiteur.
 */
export function debiteurDuContratCpt(contrat: {
  client: { id: string; nom: string };
  apporteur: { id: string; nom: string; estClient: boolean } | null;
}): DebiteurCpt {
  if (contrat.apporteur?.estClient) return { cle: `PARTENAIRE:${contrat.apporteur.id}`, type: "PARTENAIRE", id: contrat.apporteur.id, nom: contrat.apporteur.nom };
  return { cle: `CLIENT:${contrat.client.id}`, type: "CLIENT", id: contrat.client.id, nom: contrat.client.nom };
}

export interface ContratPourCreanceCpt {
  contratId: string;
  numPolice: string;
  clientId: string;
  clientNom: string;
  apporteurId: string | null;
  apporteurNom: string | null;
  produitLibelle: string;
  debiteur: DebiteurCpt;
  synthese: SyntheseContratCreanceCpt;
}

export interface DebiteurCreanceCpt {
  debiteur: DebiteurCpt;
  primeEmise: bigint;
  encaisseProuve: bigint;
  declarePayeNonProuve: bigint;
  resteDu: bigint;
  resteEchu: bigint;
  resteEnRetard: bigint;
  depuisLe: string | null;
  joursAnciennete: number | null;
  tranche: TrancheCreanceCpt | null;
  /** Les contrats AYANT un reste dû, du plus ancien impayé au plus récent. */
  contrats: ContratPourCreanceCpt[];
  /** Une relance est proposée (jamais envoyée) dès qu'une échéance est en retard. */
  relanceProposee: boolean;
}

/**
 * Regroupe par débiteur les seuls contrats qui ont un reste dû (une créance). Prime émise et encaissé prouvé sont ceux de CES contrats :
 * reste dû = prime émise − encaissé prouvé, sur le même ensemble. Tri : la dette la plus ancienne d'abord, puis le reste échu le plus gros.
 */
export function regrouperParDebiteurCpt(contrats: readonly ContratPourCreanceCpt[]): DebiteurCreanceCpt[] {
  const parCle = new Map<string, DebiteurCreanceCpt>();
  for (const c of contrats) {
    if (c.synthese.resteDu === ZERO) continue;
    let d = parCle.get(c.debiteur.cle);
    if (!d) {
      d = { debiteur: c.debiteur, primeEmise: ZERO, encaisseProuve: ZERO, declarePayeNonProuve: ZERO, resteDu: ZERO, resteEchu: ZERO, resteEnRetard: ZERO, depuisLe: null, joursAnciennete: null, tranche: null, contrats: [], relanceProposee: false };
      parCle.set(c.debiteur.cle, d);
    }
    d.primeEmise += c.synthese.primeEmise;
    d.encaisseProuve += c.synthese.encaisseProuve;
    d.declarePayeNonProuve += c.synthese.declarePayeNonProuve;
    d.resteDu += c.synthese.resteDu;
    d.resteEchu += c.synthese.resteEchu;
    d.resteEnRetard += c.synthese.resteEnRetard;
    if (c.synthese.depuisLe && (d.depuisLe === null || c.synthese.depuisLe < d.depuisLe)) {
      d.depuisLe = c.synthese.depuisLe;
      d.joursAnciennete = c.synthese.joursAnciennete;
      d.tranche = c.synthese.tranche;
    }
    if (c.synthese.nbEcheancesEnRetard > 0) d.relanceProposee = true;
    d.contrats.push(c);
  }
  const liste = [...parCle.values()];
  for (const d of liste) d.contrats.sort((a, b) => (a.synthese.depuisLe ?? "9999") .localeCompare(b.synthese.depuisLe ?? "9999") || a.numPolice.localeCompare(b.numPolice));
  return liste.sort(
    (a, b) =>
      (a.depuisLe ?? "9999").localeCompare(b.depuisLe ?? "9999") || (b.resteEchu > a.resteEchu ? 1 : b.resteEchu < a.resteEchu ? -1 : 0) || a.debiteur.nom.localeCompare(b.debiteur.nom, "fr")
  );
}

export interface RepartitionTrancheCpt {
  tranche: TrancheCreanceCpt;
  nbDebiteurs: number;
  /** Reste échu des débiteurs dont la dette la plus ancienne tombe dans cette tranche. */
  resteEchu: bigint;
}

/** Nombre de débiteurs et reste échu par tranche (la tranche d'un débiteur est celle de sa plus ancienne échéance impayée et échue). */
export function repartitionParTrancheCpt(debiteurs: readonly DebiteurCreanceCpt[]): RepartitionTrancheCpt[] {
  return TRANCHES_CREANCE_CPT.map((tranche) => {
    const concernes = debiteurs.filter((d) => d.tranche === tranche);
    return { tranche, nbDebiteurs: concernes.length, resteEchu: concernes.reduce((s, d) => s + d.resteEchu, ZERO) };
  });
}

// ---------- Filtres (GET) ----------

export const VUES_ECHEANCES_CPT = ["TOUTES", "EN_RETARD", "DUES_7J"] as const;
export type VueEcheancesCpt = (typeof VUES_ECHEANCES_CPT)[number];
export const LIBELLE_VUE_ECHEANCES_CPT: Record<VueEcheancesCpt, string> = {
  TOUTES: "En retard et dues dans les 7 jours",
  EN_RETARD: "En retard seulement",
  DUES_7J: "Dues dans les 7 jours seulement",
};

/** Horizon de la liste « dues bientôt » : 7 jours à partir d'aujourd'hui, aujourd'hui compris. */
export const HORIZON_ECHEANCES_JOURS_CPT = 7;

export interface FiltresCreancesCpt {
  /** Recherche libre d'un client (début de mot : nom, téléphone, partenaire d'origine). Vide = tous. */
  q: string;
  /** Partenaire apporteur du contrat. */
  partenaireId: string | null;
  /** Tranche d'ancienneté du débiteur (état des créances). */
  tranche: TrancheCreanceCpt | null;
  vue: VueEcheancesCpt;
}

export interface RechercheCreancesBruteCpt {
  q?: string;
  partenaire?: string;
  tranche?: string;
  vue?: string;
  page?: string;
  pageEcheances?: string;
}

/** Lit les paramètres GET ; une valeur absente ou invalide est ignorée (jamais une erreur de page). */
export function lireFiltresCreancesCpt(recherche: RechercheCreancesBruteCpt, partenairesIds: readonly string[]): FiltresCreancesCpt {
  return {
    q: (recherche.q ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
    partenaireId: partenairesIds.includes(recherche.partenaire ?? "") ? (recherche.partenaire as string) : null,
    tranche: TRANCHES_CREANCE_CPT.find((t) => t === recherche.tranche) ?? null,
    vue: VUES_ECHEANCES_CPT.find((v) => v === recherche.vue) ?? "TOUTES",
  };
}

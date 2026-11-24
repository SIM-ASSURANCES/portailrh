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

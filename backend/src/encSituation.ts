// Situation d'un contrat (module Encaissements, CDC V2.6 §5.1, commit 5a) : encaissé et reste dû, sur les seuls
// paiements CONFIRMÉS (décision du 2026-10-02). Les futures contre-passations (montants négatifs confirmés) entrent
// d'elles-mêmes dans la somme. Reste dû négatif → présenté comme un trop-perçu, jamais comme un reste dû négatif.

import { montant, type Montant, type MontantEntree } from "./encCalcul";

export interface SituationContrat {
  encaisse: Montant;
  /** 0 si le contrat est soldé ou en trop-perçu. */
  resteDu: Montant;
  /** 0 sauf si l'encaissé dépasse la prime TTC. */
  tropPercu: Montant;
}

export function calculerSituationContrat(primeTtc: MontantEntree, montantsConfirmes: readonly MontantEntree[]): SituationContrat {
  const encaisse = montantsConfirmes.reduce<Montant>((somme, z) => somme.plus(montant(z)), montant("0"));
  const ecart = montant(primeTtc).minus(encaisse);
  const zero = montant("0");
  return { encaisse, resteDu: ecart.gt(0) ? ecart : zero, tropPercu: ecart.lt(0) ? ecart.neg() : zero };
}

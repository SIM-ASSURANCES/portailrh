export interface EtatRetourAffiche {
  libelle: "Retourné à la compta" | "Retourné" | "À retourner";
  valeur: number;
  estRetourne: boolean;
  /** Retour non réceptionné mais entièrement couvert par un retour enregistré après la clôture. */
  couvertParPostCloture: boolean;
}

/**
 * État net affiché pour "À retourner" (écran Collaborateur ET écran Finance — source unique) :
 * réceptionné => "Retourné" ; non réceptionné => montant moins la part couverte par les retours
 * exceptionnels post-clôture (`getCouvertureRetoursPostCloture`), "Retourné" si entièrement couvert.
 */
export function etatRetourAffiche({
  montantARetourner,
  estReceptionne,
  dejaCouvertPostCloture,
}: {
  montantARetourner: number;
  estReceptionne: boolean;
  dejaCouvertPostCloture: number;
}): EtatRetourAffiche {
  const restant = estReceptionne ? 0 : Math.max(0, Math.round((montantARetourner - dejaCouvertPostCloture) * 100) / 100);
  const couvertParPostCloture = !estReceptionne && montantARetourner > 0 && restant === 0;
  const estRetourne = estReceptionne || couvertParPostCloture;
  return {
    // Réceptionné = remis à la comptabilité ; "Retourné" seul = couvert par un retour post-clôture (autre sens).
    libelle: estReceptionne ? "Retourné à la compta" : couvertParPostCloture ? "Retourné" : "À retourner",
    valeur: estReceptionne ? montantARetourner : restant,
    estRetourne,
    couvertParPostCloture,
  };
}

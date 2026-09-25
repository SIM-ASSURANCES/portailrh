export interface EtatRetourAffiche {
  libelle: "Retourné" | "À retourner";
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
    libelle: estRetourne ? "Retourné" : "À retourner",
    valeur: estReceptionne ? montantARetourner : restant,
    estRetourne,
    couvertParPostCloture,
  };
}

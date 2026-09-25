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

export interface MontantDefinitifAffiche {
  recu: number;
  complements: number;
  complementsEnAttente: number;
  rembourses: number;
  definitif: number;
}

/**
 * Libellé court du "Montant à retourner définitif" (écrans Finance ET Collaborateur, source unique), ex.
 * "(50 000 reçus − 5 000 remboursés)" ou "(50 000 reçus + 25 000 complétés)". N'est affiché que s'il existe au
 * moins un complément ou un remboursement validé (`aCorrection` côté serveur).
 */
export function detailMontantDefinitif(m: MontantDefinitifAffiche): string {
  const f = (n: number) => n.toLocaleString("fr-FR");
  let texte = `${f(m.recu)} reçus`;
  if (m.complements > 0) texte += ` + ${f(m.complements)} complétés`;
  if (m.rembourses > 0) texte += ` − ${f(m.rembourses)} remboursés`;
  const attente = m.complementsEnAttente > 0 ? ` ; dont ${f(m.complementsEnAttente)} de complément en attente de réception` : "";
  return `(${texte}${attente})`;
}

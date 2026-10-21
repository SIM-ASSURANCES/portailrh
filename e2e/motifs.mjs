// Lot M — motif obligatoire (10 à 300 caractères) dans les deux sens Finance <-> DG : aides communes aux scripts e2e.
export const MOTIF = "Motif de test e2e suffisant";
export const MOTIF_COURT = "trop bref";
export const MOTIF_LONG = "x".repeat(301);

/** Remplit le champ « Motif » (ChampMotifEchange) dont le `name` est donné, ou le premier visible si aucun nom n'est donné. */
export async function remplirMotif(p, texte = MOTIF, name = null) {
  const champ = name ? p.locator(`[data-motif-echange][name="${name}"]`) : p.locator("[data-motif-echange]:visible").first();
  await champ.fill(texte);
}

/** Motif d'envoi au DG d'un article (champ propre à chaque carte d'article). */
export const remplirMotifArticle = (p, ligneId, texte = MOTIF) => remplirMotif(p, texte, `motifSoumission-${ligneId}`);

/** Remplit le champ « Motif » situé DANS le bloc donné (carte d'un article soumis au DG, par exemple). */
export const remplirMotifDans = (bloc, texte = MOTIF) => bloc.locator("[data-motif-echange]").last().fill(texte);

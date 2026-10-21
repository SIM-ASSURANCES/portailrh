// Chargement de l'évaluation de clôture d'une demande à articles (lot C) : lecture seule, sur la régularisation par
// article (`getRegularisationParArticle`) — aucune formule propre, la règle est `clotureDemande.ts` (pure).

import { evaluerCloture, type ArticleCloture, type EvaluationCloture } from "./clotureDemande";
import { getRegularisationParArticle, type RegularisationDemandeVue } from "./regularisationArticleDb";

export interface EvaluationClotureChargee {
  evaluation: EvaluationCloture;
  articles: ArticleCloture[];
  vue: RegularisationDemandeVue;
}

/** Évaluation de la clôture d'une demande À ARTICLES (la dépense directe garde la règle d'origine, `peutEtreCloturee`). */
export async function chargerEvaluationCloture(demandeId: string): Promise<EvaluationClotureChargee> {
  const vue = await getRegularisationParArticle(demandeId);
  const articles: ArticleCloture[] = vue.articles.map((a) => ({
    ligneId: a.ligneId,
    libelle: a.libelle,
    beneficiaire: a.beneficiaire,
    statut: a.statut,
    montantValide: a.montantValide,
    agregats: a.agregats,
    retoursEnAttente: a.retoursEnAttente,
  }));
  return { evaluation: evaluerCloture(articles, vue.aDuNonRattache ? vue.nonRattache : null), articles, vue };
}

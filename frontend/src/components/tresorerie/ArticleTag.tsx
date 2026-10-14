import type { ResumeArticle } from "backend";

/**
 * « Article : <libellé> · Bénéficiaire : X · Montant validé : Y » (lot E) — nomme l'article concerné par une dépense, un
 * retour ou un bloc de régularisation. `vueDemandeur` : le demandeur voit la version d'origine du libellé.
 * Sans article (`article` nul) : règlement non rattaché (dépense directe, ou ancien règlement ambigu).
 */
export function ArticleTag({ article, vueDemandeur = false }: { article: ResumeArticle | null; vueDemandeur?: boolean }) {
  if (!article) {
    return (
      <p data-article-tag="aucun" className="text-xs text-muted-foreground">
        Article : aucun (règlement non rattaché à un article)
      </p>
    );
  }
  return (
    <p data-article-tag={article.ligneId} className="text-xs text-muted-foreground">
      <span className="font-semibold text-foreground">Article : {vueDemandeur ? article.libelleDemandeur : article.libelle}</span>
      {" · "}Bénéficiaire : {article.beneficiaire}
      {" · "}Montant validé : {article.montantValide.toLocaleString("fr-FR")} FCFA
    </p>
  );
}

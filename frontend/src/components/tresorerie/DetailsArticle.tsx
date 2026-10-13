import type { ParcoursArticle, VueDetailsArticles } from "backend";

import { Badge } from "@/components/ui";

import { ParcoursArticleView } from "./ParcoursArticle";

export interface PieceLien {
  id: string;
}

/**
 * Bénéficiaire et pièces jointes d'UN article (autonomie des articles, lot A) — composant d'affichage partagé par les
 * écrans du demandeur, du responsable de service, du DG et de la Finance. Le bénéficiaire propre à l'article porte le
 * badge « Personnalisé » ; sans bénéficiaire propre, l'article « hérite » de celui de la demande (rien n'est ajouté
 * quand il n'y a qu'un seul bénéficiaire, pour ne pas alourdir les demandes simples).
 */
export function DetailsArticle({
  beneficiaireLibelle,
  beneficiairePropre,
  afficherBeneficiaire,
  pieces,
  piecesCommunes,
}: {
  beneficiaireLibelle: string;
  beneficiairePropre: boolean;
  /** `false` : toutes les lignes ont le même bénéficiaire que la demande, on ne le répète pas. */
  afficherBeneficiaire: boolean;
  pieces: PieceLien[];
  piecesCommunes: PieceLien[];
}) {
  if (!afficherBeneficiaire && pieces.length === 0 && piecesCommunes.length === 0) return null;
  const lien = "text-info underline-offset-4 transition-colors hover:text-primary hover:underline";
  return (
    <div data-details-article className="mt-1 space-y-0.5 text-xs font-normal text-muted-foreground">
      {afficherBeneficiaire ? (
        <p data-beneficiaire-article>
          Bénéficiaire : <span className="text-foreground">{beneficiaireLibelle}</span>{" "}
          {beneficiairePropre ? <Badge variant="info">Personnalisé</Badge> : null}
        </p>
      ) : null}
      {pieces.length > 0 ? (
        <p data-pieces-article>
          Pièces de l&apos;article :{" "}
          {pieces.map((p, i) => (
            <a key={p.id} href={`/api/treso/pieces-jointes/${p.id}`} className={`${lien} mr-2`}>
              Télécharger{pieces.length > 1 ? ` (${i + 1})` : ""}
            </a>
          ))}
        </p>
      ) : null}
      {piecesCommunes.length > 0 ? (
        <p data-pieces-communes>
          Pièce commune :{" "}
          {piecesCommunes.map((p, i) => (
            <a key={p.id} href={`/api/treso/pieces-jointes/${p.id}`} className={`${lien} mr-2`}>
              Télécharger{piecesCommunes.length > 1 ? ` (${i + 1})` : ""}
            </a>
          ))}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Détails d'un article à partir de la vue calculée par `detailsArticles` (une seule fois par page), suivis — lot D —
 * de son parcours (badge d'état, montants clés, étapes atteintes) quand les parcours de la demande sont fournis.
 */
export function detailsArticleDe(vue: VueDetailsArticles, ligneId: string, parcours?: ReadonlyMap<string, ParcoursArticle>) {
  const v = vue.parArticle.get(ligneId);
  const p = parcours?.get(ligneId);
  if (!v && !p) return null;
  return (
    <>
      {v ? (
        <DetailsArticle
          beneficiaireLibelle={v.beneficiaire.libelle}
          beneficiairePropre={v.beneficiaire.propre}
          afficherBeneficiaire={vue.afficherBeneficiaire}
          pieces={v.pieces}
          piecesCommunes={vue.detaille ? vue.communes : []}
        />
      ) : null}
      {p ? <ParcoursArticleView parcours={p} /> : null}
    </>
  );
}

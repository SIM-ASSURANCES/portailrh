"use client";

import { useState } from "react";

import { BeneficiaireChamp } from "@/components/tresorerie/BeneficiaireChamp";
import { PiecesJointesMultiples, type PieceSaisie } from "@/components/tresorerie/PiecesJointesMultiples";
import { Badge } from "@/components/ui";
import { estPersonnalise, type SaisieBeneficiaire } from "backend/client";

export interface DetailsArticleSaisie {
  /** `null` : « identique aux autres » (hérite de la valeur commune). */
  beneficiaire: SaisieBeneficiaire | null;
  pieces: PieceSaisie[];
}

/**
 * « Détails de l'article » (autonomie des articles, lot A) : bénéficiaire et pièces propres à un article, repliés par
 * défaut. Le badge dit si l'article reprend la valeur commune (« Identique aux autres ») ou non (« Personnalisé ») ;
 * un article dont le bénéficiaire égale la valeur commune n'enregistre rien (il hérite).
 */
export function DetailsArticleEditeur({
  details,
  commun,
  createurId,
  comptes,
  onChange,
  erreur,
}: {
  details: DetailsArticleSaisie;
  commun: SaisieBeneficiaire;
  createurId: string;
  comptes: { value: string; label: string }[];
  onChange: (patch: Partial<DetailsArticleSaisie>) => void;
  erreur?: string;
}) {
  const [ouvert, setOuvert] = useState(false);
  const personnalise = estPersonnalise({ beneficiaire: details.beneficiaire, pieces: [] }, commun, createurId);
  const resume = [
    personnalise ? "bénéficiaire propre" : null,
    details.pieces.length > 0 ? `${details.pieces.length} pièce(s)` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div data-details-article-editeur className="mt-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={ouvert}
          onClick={() => setOuvert((o) => !o)}
          className="text-xs font-semibold text-primary underline-offset-4 hover:underline"
        >
          {ouvert ? "Masquer les détails de l'article" : "Détails de l'article"}
        </button>
        <Badge variant={personnalise ? "info" : "neutral"}>{personnalise ? "Personnalisé" : "Identique aux autres"}</Badge>
        {resume ? <span className="text-xs text-muted-foreground">{resume}</span> : null}
        {personnalise ? (
          <button
            type="button"
            data-retablir-commun
            onClick={() => onChange({ beneficiaire: null })}
            className="text-xs font-medium text-info underline-offset-4 hover:underline"
          >
            Rétablir la valeur commune
          </button>
        ) : null}
      </div>
      {erreur ? <p className="mt-1 text-xs text-danger">{erreur}</p> : null}
      {ouvert ? (
        <div className="mt-3 space-y-3">
          <BeneficiaireChamp
            label="Bénéficiaire de cet article"
            value={details.beneficiaire ?? commun}
            onChange={(v) => onChange({ beneficiaire: v })}
            comptes={comptes}
            error={erreur}
          />
          <PiecesJointesMultiples pieces={details.pieces} onChange={(pieces) => onChange({ pieces })} />
        </div>
      ) : null}
    </div>
  );
}

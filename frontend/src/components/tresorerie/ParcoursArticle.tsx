import type { ParcoursArticle } from "backend";
import { libelleGestionArticle } from "backend/client";

import { Badge } from "@/components/ui";

const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

/**
 * Parcours d'UN article (autonomie des articles, lot D) : badge d'état, montants clés et seules les étapes atteintes
 * (Validé → Réglé → Retour de caisse → Régularisé). Composant d'affichage partagé par les écrans du demandeur, du
 * responsable de service, du DG et de la Finance ; les données viennent de `getParcoursArticles` (calculées une seule
 * fois par page). Un champ qui ne s'applique pas encore n'est jamais affiché.
 */
export function ParcoursArticleView({ parcours }: { parcours: ParcoursArticle }) {
  const { montants: m } = parcours;
  const cles: { cle: string; libelle: string; valeur: string; attention?: boolean }[] = [];
  if (m.valide > 0) cles.push({ cle: "valide", libelle: "Validé", valeur: fcfa(m.valide) });
  if (m.regle > 0) cles.push({ cle: "regle", libelle: "Réglé", valeur: fcfa(m.regle) });
  if (m.regle > 0 && m.reste > 0) cles.push({ cle: "reste", libelle: "Reste à régler", valeur: fcfa(m.reste), attention: true });
  if (m.retourAttendu != null) {
    cles.push({ cle: "retour", libelle: "Retour attendu / reçu", valeur: `${fcfa(m.retourAttendu)} / ${fcfa(m.retourRecu ?? 0)}` });
  }
  return (
    <div data-parcours-article data-parcours-badge={parcours.badge} className="mt-2 space-y-1.5 text-xs font-normal">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge variant={parcours.variante}>{parcours.libelleBadge}</Badge>
        {parcours.precision ? <span className="text-muted-foreground">{parcours.precision}</span> : null}
        {cles.map((c) => (
          <span key={c.cle} className="text-muted-foreground" data-parcours-montant={c.cle}>
            {c.libelle} :{" "}
            <span className={`font-semibold tabular-nums ${c.attention ? "text-warning" : "text-foreground"}`}>{c.valeur}</span>
          </span>
        ))}
      </div>
      <p data-gere-le className="text-muted-foreground">
        {libelleGestionArticle(parcours.gere)}
      </p>
      {parcours.etapes.length > 0 ? (
        <ol className="space-y-0.5 border-l-2 border-border pl-3 text-muted-foreground">
          {parcours.etapes.map((e) => (
            <li key={e.cle} data-parcours-etape={e.cle}>
              <span className="font-medium text-foreground">{e.libelle}</span>
              {e.lignes.map((l, i) => (
                <span key={i} className="block">
                  {l}
                </span>
              ))}
            </li>
          ))}
        </ol>
      ) : null}
      {parcours.note ? <p className="text-warning">{parcours.note}</p> : null}
    </div>
  );
}

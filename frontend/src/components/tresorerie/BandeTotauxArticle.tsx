import { totauxBandeArticle, type AgregatsRegularisation } from "backend";

const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

/**
 * Bande « Total de l'article » (lot G quater), au-dessus des sous-blocs par règlement : somme de TOUS les règlements de
 * l'article (Caisse + Banque). Affichée seulement quand l'article a plus d'un règlement ; les chiffres viennent de
 * `totauxBandeArticle` (même reste que `resteNonDetailleTotal`). Lecture seule.
 */
export function BandeTotauxArticle({ agregats, titre = "Total de l'article" }: { agregats: AgregatsRegularisation; titre?: string }) {
  const t = totauxBandeArticle(agregats);
  return (
    <div data-bande-total-article className="space-y-1.5">
      <p className="text-xs font-bold uppercase tracking-wide text-foreground">{titre}</p>
      <dl className="grid grid-cols-2 gap-3 rounded-lg border border-primary/30 bg-muted/60 p-3 text-sm sm:grid-cols-5">
        <Case libelle="Remis (Caisse + Banque)" valeur={t.remis} />
        <Case libelle="Détaillé" valeur={t.detaille} />
        <Case libelle="Reste non détaillé" valeur={t.reste} attention={t.reste > 0} />
        <Case libelle="Sans pièce formelle" valeur={t.sansPiece} attention={t.sansPiece > 0} />
        <Case libelle="Retourné" valeur={t.retourne} />
      </dl>
    </div>
  );
}

function Case({ libelle, valeur, attention = false }: { libelle: string; valeur: number; attention?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{libelle}</dt>
      <dd className={`font-bold tabular-nums ${attention ? "text-warning" : "text-foreground"}`}>{fcfa(valeur)}</dd>
    </div>
  );
}

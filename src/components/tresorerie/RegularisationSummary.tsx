import { getDepensesDeclarees, getRetoursRecus, getTotalRegle } from "@/lib/tresorerie";

/**
 * Chiffres de régularisation d'une demande (montant décaissé, dépenses
 * déclarées, retours reçus, écart) — Server Component autonome, purement
 * informatif (aucune action). Partagé entre l'écran Finance (section
 * "Régularisation", actionnable via `ClotureActions` à côté, ou en lecture
 * seule une fois clôturée) et l'écran Collaborateur (section "Situation
 * finale", Ticket 7), pour ne jamais dupliquer le calcul de l'écart ni sa
 * mise en couleur.
 *
 * Même convention que le "Reste à régler" de `ReglementsSection.tsx`
 * (Ticket 4) : `text-success` quand tout est justifié (écart nul),
 * `text-warning` sinon — une alerte informative, pas une erreur bloquante.
 */
export async function RegularisationSummary({
  demandeId,
  montantValide,
  title = "Régularisation",
}: {
  demandeId: string;
  montantValide: number;
  title?: string;
}) {
  const [decaisse, depensesDeclarees, retoursRecus] = await Promise.all([
    getTotalRegle(demandeId),
    getDepensesDeclarees(demandeId),
    getRetoursRecus(demandeId),
  ]);
  const ecart = decaisse - depensesDeclarees - retoursRecus;

  return (
    <div className="space-y-5 rounded-2xl border border-border bg-surface p-5 shadow-elevated sm:p-6">
      <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
        <span className="h-4 w-1 rounded-full bg-primary" aria-hidden="true" />
        {title}
      </h2>
      <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Montant décaissé
          </dt>
          <dd className="mt-1 text-xl font-black tracking-tight text-foreground tabular-nums">
            {decaisse.toLocaleString("fr-FR")} <span className="text-sm font-bold text-muted-foreground">FCFA</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Dépenses déclarées
          </dt>
          <dd className="mt-1 text-xl font-black tracking-tight text-foreground tabular-nums">
            {depensesDeclarees.toLocaleString("fr-FR")}{" "}
            <span className="text-sm font-bold text-muted-foreground">FCFA</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Retours reçus
          </dt>
          <dd className="mt-1 text-xl font-black tracking-tight text-foreground tabular-nums">
            {retoursRecus.toLocaleString("fr-FR")} <span className="text-sm font-bold text-muted-foreground">FCFA</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Écart</dt>
          <dd
            className={`mt-1 text-xl font-black tracking-tight tabular-nums ${ecart === 0 ? "text-success" : "text-warning"}`}
          >
            {ecart.toLocaleString("fr-FR")} <span className="text-sm font-bold opacity-70">FCFA</span>
          </dd>
        </div>
      </dl>
      <p className="border-t border-border pt-3 text-xs font-medium text-muted-foreground">
        Montant validé de la demande :{" "}
        <span className="font-bold text-foreground">{montantValide.toLocaleString("fr-FR")} FCFA</span>.
      </p>
    </div>
  );
}

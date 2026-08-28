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
  montantDemande,
  title = "Régularisation",
}: {
  demandeId: string;
  montantDemande: number;
  title?: string;
}) {
  const [decaisse, depensesDeclarees, retoursRecus] = await Promise.all([
    getTotalRegle(demandeId),
    getDepensesDeclarees(demandeId),
    getRetoursRecus(demandeId),
  ]);
  const ecart = decaisse - depensesDeclarees - retoursRecus;

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Montant décaissé
          </dt>
          <dd className="text-sm font-semibold text-foreground">
            {decaisse.toLocaleString("fr-FR")} FCFA
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Dépenses déclarées
          </dt>
          <dd className="text-sm font-semibold text-foreground">
            {depensesDeclarees.toLocaleString("fr-FR")} FCFA
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Retours reçus
          </dt>
          <dd className="text-sm font-semibold text-foreground">
            {retoursRecus.toLocaleString("fr-FR")} FCFA
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Écart</dt>
          <dd className={`text-sm font-semibold ${ecart === 0 ? "text-success" : "text-warning"}`}>
            {ecart.toLocaleString("fr-FR")} FCFA
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">
        Montant validé de la demande : {montantDemande.toLocaleString("fr-FR")} FCFA.
      </p>
    </div>
  );
}

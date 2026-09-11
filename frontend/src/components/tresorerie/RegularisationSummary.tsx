import { getDepensesDeclarees, getRetoursRecus, getTotalRegle } from "backend";

/**
 * Chiffres de régularisation d'une demande ("Fonds remis (Caisse + Banque)",
 * "Dépenses effectuées", "Retours reçus", "Solde à régulariser" — libellés
 * renommés, voir CLAUDE.md "Renommage de libellés Régularisation/Retour de
 * caisse" puis "Distinction Fonds remis (Caisse + Banque) vs Fonds remis
 * (Caisse seule)" ; variables internes `decaisse`/`ecart` volontairement
 * inchangées) — `decaisse` = `getTotalRegle`, tous modes de règlement
 * confondus, d'où le libellé précisant "(Caisse + Banque)" plutôt que le
 * "Fonds remis" simple utilisé dans le reporting/l'export Excel (ceux-là
 * strictement Caisse, voir la section CLAUDE.md ci-dessus). Server
 * Component autonome, purement informatif (aucune action). Partagé entre
 * l'écran Finance (section "Régularisation", actionnable via
 * `ClotureActions` à côté, ou en lecture seule une fois clôturée) et
 * l'écran Collaborateur (section "Situation finale", Ticket 7), pour ne
 * jamais dupliquer le calcul de l'écart ni sa mise en couleur.
 *
 * Même convention que le "Reste à régler" de `ReglementsSection.tsx`
 * (Ticket 4) : `text-success` quand tout est justifié (solde nul),
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
            Fonds remis (Caisse + Banque)
          </dt>
          <dd className="mt-1 text-xl font-black tracking-tight text-foreground tabular-nums">
            {decaisse.toLocaleString("fr-FR")} <span className="text-sm font-bold text-muted-foreground">FCFA</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Dépenses effectuées
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
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Solde à régulariser</dt>
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

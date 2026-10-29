import { detailClotureForcee, lireInstantaneClotureForcee } from "backend/client";

/**
 * Bandeau d'une demande clôturée de FORCE (lot C) : qui, quand, motif et articles non régularisés avec leur solde restant
 * (instantané pris à la clôture). Rien n'est affiché pour une clôture ordinaire. Composant d'affichage partagé par l'écran
 * Finance et l'écran du demandeur : le demandeur est prévenu de cette clôture, il n'y a donc rien de confidentiel.
 */
export function ClotureForceeBandeau({
  demande,
}: {
  demande: {
    clotureForcee: boolean;
    clotureForceeAt: Date | null;
    clotureForceePar?: { fullName: string } | null;
    motifCloture: string | null;
    clotureForceeArticles: unknown;
  };
}) {
  if (!demande.clotureForcee) return null;
  const articles = lireInstantaneClotureForcee(demande.clotureForceeArticles);
  return (
    <div data-cloture-forcee className="space-y-2 rounded-lg border border-danger bg-danger-bg p-4 text-sm text-danger sm:p-6">
      <p className="font-semibold">
        Clôturée sans régularisation complète
        {demande.clotureForceePar ? ` par ${demande.clotureForceePar.fullName}` : ""}
        {demande.clotureForceeAt ? ` le ${demande.clotureForceeAt.toLocaleDateString("fr-FR", { timeZone: "Africa/Abidjan" })}` : ""}.
      </p>
      {demande.motifCloture ? <p>Motif : {demande.motifCloture}</p> : null}
      {articles.length > 0 ? (
        <p data-articles-non-regularises>Articles non régularisés à la clôture : {detailClotureForcee(articles)}.</p>
      ) : null}
    </div>
  );
}

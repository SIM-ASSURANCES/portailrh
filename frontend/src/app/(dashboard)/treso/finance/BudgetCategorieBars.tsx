import { EmptyState } from "@/components/ui";
import type { CategorieBudgetSuivi } from "backend";

/**
 * Barres de consommation budgétaire des catégories les plus consommées
 * (`getTopCategoriesBudget`, top 5 par défaut) — même donnée que le
 * contrôle bloquant du règlement et l'aperçu affiché à la catégorisation
 * (voir CLAUDE.md "Budget partagé par Catégorie" / "Budget visible au
 * moment de la catégorisation"), jamais un second calcul. Barre rouge et
 * plafonnée à 100% visuellement en cas de dépassement réel (le montant
 * affiché à côté, lui, reste la valeur brute non plafonnée).
 */
export function BudgetCategorieBars({ categories }: { categories: CategorieBudgetSuivi[] }) {
  if (categories.length === 0) {
    return <EmptyState icon="book-text" message="Aucune catégorie avec un budget alloué pour l'instant." compact />;
  }

  return (
    <div className="space-y-4">
      {categories.map((c) => {
        const pourcentage = c.budgetAlloue > 0 ? Math.min(100, (c.consomme / c.budgetAlloue) * 100) : 0;
        const depasse = c.restant < 0;
        return (
          <div key={c.id}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-semibold text-foreground">{c.label}</span>
              <span className={`shrink-0 tabular-nums ${depasse ? "font-semibold text-danger" : "text-muted-foreground"}`}>
                {c.consomme.toLocaleString("fr-FR")} / {c.budgetAlloue.toLocaleString("fr-FR")} FCFA
              </span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${depasse ? "bg-danger" : "bg-primary"}`}
                style={{ width: `${pourcentage}%` }}
              />
            </div>
            {depasse ? (
              <p className="mt-1 text-xs font-medium text-danger">
                Dépassement de {Math.abs(c.restant).toLocaleString("fr-FR")} FCFA
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

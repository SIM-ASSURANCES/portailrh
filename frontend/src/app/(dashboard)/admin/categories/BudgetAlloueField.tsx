import Link from "next/link";

import { libellePeriodeBudget, libelleSeuil, type SeuilBudget } from "backend/client";

/**
 * Budget EN VIGUEUR d'une Catégorie, en lecture seule (lot J, 2026-10-19). Il n'est plus modifiable ici : la Finance le
 * paramètre (montant, date d'effet, seuils d'alerte) sur l'écran « Budgets » et le DG le valide ; l'ancien champ éditable
 * (qui écrivait `Categorie.budgetAlloue` sans validation) a disparu.
 */
export function BudgetAlloueField({
  budget,
  lienBudgets = false,
}: {
  budget: { montant: number; dateDebut: string; dateFin: string | null; seuil: SeuilBudget | null } | null;
  /** Affiche le lien vers l'écran « Budgets » (comptes de l'espace Finance seulement). */
  lienBudgets?: boolean;
}) {
  return (
    <span data-budget-en-vigueur className="flex flex-wrap items-center gap-2 text-sm text-foreground">
      {budget ? (
        <>
          <span className="font-black tabular-nums">{budget.montant.toLocaleString("fr-FR")} FCFA</span>
          <span className="text-xs text-muted-foreground">
            {libellePeriodeBudget(budget.dateDebut, budget.dateFin)} · {libelleSeuil(budget.seuil)}
          </span>
        </>
      ) : (
        <span className="text-muted-foreground">Aucun budget en vigueur (aucune limite).</span>
      )}
      {lienBudgets ? (
        <Link href="/treso/finance/budgets" className="text-xs text-info underline-offset-4 hover:text-primary hover:underline">
          Gérer les budgets
        </Link>
      ) : null}
    </span>
  );
}

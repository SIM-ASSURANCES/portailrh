import { chargerContexteBudget, prisma } from "backend";

import type { BudgetValidation } from "@/app/(dashboard)/treso/finance/demandes/[id]/LignesValidationTable";
import { hasPermission } from "@/lib/auth";

/**
 * Budgets à la validation d'une demande (lot J) pour les écrans Finance et DG : budgets EN VIGUEUR avec ce qui est déjà
 * réservé, et l'état des confirmations de dépassement de CETTE demande. `null` quand aucun budget n'est en vigueur (rien à
 * afficher, aucune alerte possible). Lecture seule.
 */
export async function chargerBudgetValidation(
  demandeId: string,
  session: { permissions: string[] } & Parameters<typeof hasPermission>[0]
): Promise<BudgetValidation | null> {
  const [contexte, confirmees, demandees] = await Promise.all([
    chargerContexteBudget(),
    prisma.budgetDepassement.count({ where: { demandeId, statut: "CONFIRME" } }),
    prisma.budgetDepassement.count({ where: { demandeId, statut: "DEMANDE" } }),
  ]);
  if (!contexte.global && Object.keys(contexte.categories).length === 0) return null;
  return {
    contexte,
    estDG: hasPermission(session, "treso.decider_dg"),
    confirmationDonnee: confirmees > 0,
    confirmationDemandee: demandees > 0,
  };
}

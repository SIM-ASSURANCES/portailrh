import { redirect } from "next/navigation";

/**
 * Lot J ter (2026-10-20) : la gestion des catégories est fusionnée dans la page « Budgets » (onglet « Catégories »). L'entrée de menu
 * « Catégories » n'existe plus ; l'ancienne adresse redirige vers cet onglet (anciens liens, favoris). Aucune fonction n'a été
 * supprimée : le contrôle d'accès (Admin ou `treso.gerer_categories`) est celui de la page Budgets et de chaque Server Action.
 */
export default function FinanceCategoriesRedirection() {
  redirect("/treso/finance/budgets?onglet=categories");
}

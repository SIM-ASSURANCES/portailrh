"use client";

import { Badge } from "@/components/ui";

import { ActiveToggleButton } from "./ActiveToggleButton";
import {
  supprimerCategorieAction,
  supprimerObjetAction,
  toggleCategorieActiveAction,
  toggleObjetActiveAction,
} from "./actions";
import type { SeuilBudget } from "backend/client";

import { BudgetAlloueField } from "./BudgetAlloueField";
import { DeleteButton } from "./DeleteButton";
import { ObjetCreateForm } from "./ObjetCreateForm";

export interface ObjetRow {
  id: string;
  label: string;
  isActive: boolean;
  /** Lot J bis : « Désactivé le … par … » (historique), pour un élément inactif. */
  desactivation?: string | null;
}

export interface CategorieRow {
  id: string;
  label: string;
  isActive: boolean;
  /** Lot J bis : « Désactivée le … par … » (historique), pour une catégorie inactive. */
  desactivation?: string | null;
  /** Budget EN VIGUEUR (lot J, paramétrage validé par le DG). `null` = aucune limite. */
  budget: { montant: number; dateDebut: string; dateFin: string | null; seuil: SeuilBudget | null } | null;
  objets: ObjetRow[];
}

/**
 * Liste des catégories avec leurs objets imbriqués (liste indentée en
 * dessous de chaque catégorie, comme demandé). Les inactives sont
 * distinguées par une opacité réduite en plus du Badge de statut.
 *
 * **Suppression définitive** (voir CLAUDE.md "Gestion des Catégories/Objets
 * ouverte à Finance") : disponible pour quiconque a atteint cette page — la
 * garde d'accès (Admin ou `treso.gerer_categories`) est déjà assurée par la
 * page appelante, jamais revérifiée ici (composant purement de
 * présentation). **Désactiver / Réactiver** (prop `canToggleActive`, lot J
 * bis : Admin ou `treso.gerer_categories`) : masqué entièrement plutôt que
 * désactivé quand le compte n'y a pas droit, jamais un bouton voué à échouer
 * côté serveur.
 *
 * **Budget alloué** (voir CLAUDE.md "Finance peut définir le budget d'une
 * catégorie") — prop DISTINCTE `canModifierBudget` (défaut = `isAdmin`,
 * pour ne rien changer à l'appel existant depuis `/admin/categories`) :
 * ouvert en plus au Responsable Finance depuis cette tâche, jamais fusionné
 * avec `isAdmin` (qui continue de piloter Activer/Désactiver seul).
 */
export function CategoriesList({
  categories,
  isAdmin,
  canModifierBudget = isAdmin,
  canToggleActive = isAdmin,
  lienBudgets = false,
}: {
  categories: CategorieRow[];
  isAdmin: boolean;
  canModifierBudget?: boolean;
  /** Lot J bis : Désactiver / Réactiver. Ouvert à la Finance (`treso.gerer_categories`) en plus de l'Admin, distinct de `isAdmin`. */
  canToggleActive?: boolean;
  /** Lot J : affiche le lien vers l'écran « Budgets » (espace Finance). */
  lienBudgets?: boolean;
}) {
  if (categories.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucune catégorie pour l&apos;instant.</p>;
  }

  return (
    <ul className="space-y-4">
      {categories.map((categorie) => (
        <li
          key={categorie.id}
          className={`space-y-3 rounded-md border border-border p-4 ${categorie.isActive ? "" : "opacity-60"}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">{categorie.label}</span>
              <Badge variant={categorie.isActive ? "success" : "neutral"}>
                {categorie.isActive ? "Active" : "Inactive"}
              </Badge>
              {!categorie.isActive && categorie.desactivation ? (
                <span data-desactivation className="text-xs text-muted-foreground">{categorie.desactivation}</span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canToggleActive ? (
                <ActiveToggleButton
                  id={categorie.id}
                  isActive={categorie.isActive}
                  toggleAction={toggleCategorieActiveAction}
                />
              ) : null}
              <DeleteButton id={categorie.id} deleteAction={supprimerCategorieAction} />
            </div>
          </div>

          {canModifierBudget ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Budget en vigueur
              </span>
              <BudgetAlloueField budget={categorie.budget} lienBudgets={lienBudgets} />
            </div>
          ) : null}

          {categorie.objets.length > 0 ? (
            <ul className="space-y-2 border-l-2 border-border pl-4">
              {categorie.objets.map((objet) => (
                <li
                  key={objet.id}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted px-3 py-2 ${
                    objet.isActive ? "" : "opacity-60"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-foreground">{objet.label}</span>
                    <Badge variant={objet.isActive ? "success" : "neutral"}>
                      {objet.isActive ? "Actif" : "Inactif"}
                    </Badge>
                    {!objet.isActive && objet.desactivation ? (
                      <span data-desactivation className="text-xs text-muted-foreground">{objet.desactivation.replace("Désactivée", "Désactivé")}</span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {canToggleActive ? (
                      <ActiveToggleButton
                        id={objet.id}
                        isActive={objet.isActive}
                        toggleAction={toggleObjetActiveAction}
                      />
                    ) : null}
                    <DeleteButton id={objet.id} deleteAction={supprimerObjetAction} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pl-4 text-xs text-muted-foreground">Aucun objet pour l&apos;instant.</p>
          )}

          <div className="border-l-2 border-border pl-4">
            <ObjetCreateForm categorieId={categorie.id} />
          </div>
        </li>
      ))}
    </ul>
  );
}

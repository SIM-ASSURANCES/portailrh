"use client";

import { Badge } from "@/components/ui";

import { ActiveToggleButton } from "./ActiveToggleButton";
import { toggleCategorieActiveAction, toggleObjetActiveAction } from "./actions";
import { BudgetAlloueField } from "./BudgetAlloueField";
import { ObjetCreateForm } from "./ObjetCreateForm";

export interface ObjetRow {
  id: string;
  label: string;
  isActive: boolean;
}

export interface CategorieRow {
  id: string;
  label: string;
  isActive: boolean;
  /** Budget partagé — voir CLAUDE.md "Budget partagé par Catégorie". `null` = aucune limite. */
  budgetAlloue: number | null;
  objets: ObjetRow[];
}

/**
 * Liste des catégories avec leurs objets imbriqués (liste indentée en
 * dessous de chaque catégorie, comme demandé). Les inactives sont
 * distinguées par une opacité réduite en plus du Badge de statut — pas de
 * suppression définitive dans cette interface : uniquement Activer/Désactiver.
 */
export function CategoriesList({ categories }: { categories: CategorieRow[] }) {
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
            </div>
            <ActiveToggleButton
              id={categorie.id}
              isActive={categorie.isActive}
              toggleAction={toggleCategorieActiveAction}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Budget alloué
            </span>
            <BudgetAlloueField categorieId={categorie.id} budgetAlloue={categorie.budgetAlloue} />
          </div>

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
                  </div>
                  <ActiveToggleButton
                    id={objet.id}
                    isActive={objet.isActive}
                    toggleAction={toggleObjetActiveAction}
                  />
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

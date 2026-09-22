"use client";

import { Input } from "@/components/ui";

export interface CategorieAllocationOption {
  categorieId: string;
  categorieLabel: string;
  restant: number | null;
}

/**
 * Champs de répartition explicite d'un règlement par Catégorie — voir
 * CLAUDE.md "Allocation budgétaire explicite par règlement" (Option 2 du
 * diagnostic : Finance répartit elle-même, jamais un apportionnement
 * proportionnel calculé). Rendu UNIQUEMENT quand `categories.length >= 2`
 * (le cas le plus fréquent — une seule catégorie concernée, y compris
 * toute `DEPENSE_DIRECTE` — reste sans aucun champ visible, allocation à
 * 100% créée automatiquement côté serveur) ; partagé par `ReglementForm`
 * (création) et `ReglementRow` (modification d'un brouillon), mêmes noms
 * de champs `alloc_<categorieId>` que `construireAllocations`
 * (`reglementActions.ts`), pour que le `FormData` natif soit lu à
 * l'identique aux deux endroits.
 *
 * Le "Restant" affiché par catégorie est **purement informatif**, déjà
 * calculé côté serveur une fois pour toute la page (`getCategoriesConcerneesDemande`,
 * réutilise `getMontantConsommeCategorie`) — jamais recalculé au changement
 * de valeur, même convention que `BudgetCategorieApercu`
 * (`CategorisationForm.tsx`). Le contrôle bloquant réel reste au serveur,
 * à la confirmation (`confirmerReglementAction`).
 *
 * La somme des champs doit égaler EXACTEMENT le montant total du
 * règlement — vérifié ici côté client pour un retour immédiat (désactive
 * le bouton d'enregistrement tant que ce n'est pas le cas), revérifié de
 * toute façon côté serveur (`construireAllocations`), qui reste la seule
 * autorité.
 */
export function AllocationCategorieFields({
  categories,
  montantTotal,
  values,
  onChange,
}: {
  categories: CategorieAllocationOption[];
  montantTotal: number;
  values: Record<string, string>;
  onChange: (categorieId: string, valeur: string) => void;
}) {
  const somme = categories.reduce((total, c) => total + (Number(values[c.categorieId]) || 0), 0);
  const sommeValide = Math.round(somme * 100) === Math.round(montantTotal * 100);

  return (
    <div className="animate-fade-in-up space-y-3 rounded-md border border-border p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Répartition par catégorie
      </p>
      <p className="text-xs text-muted-foreground">
        Cette demande concerne plusieurs catégories — chacune a un budget indépendant : répartissez le
        montant du règlement entre elles (la somme doit égaler exactement le montant total).
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {categories.map((c) => (
          <Input
            key={c.categorieId}
            name={`alloc_${c.categorieId}`}
            label={c.categorieLabel}
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            required
            hint={c.restant != null ? `Restant avant ce règlement : ${c.restant.toLocaleString("fr-FR")} FCFA` : undefined}
            value={values[c.categorieId] ?? ""}
            onChange={(e) => onChange(c.categorieId, e.target.value)}
          />
        ))}
      </div>
      <p className={`text-xs font-semibold ${sommeValide ? "text-success" : "text-danger"}`}>
        Total réparti : {somme.toLocaleString("fr-FR")} FCFA
        {" "}
        {sommeValide ? "— correspond au montant du règlement." : `(doit égaler ${montantTotal.toLocaleString("fr-FR")} FCFA)`}
      </p>
    </div>
  );
}

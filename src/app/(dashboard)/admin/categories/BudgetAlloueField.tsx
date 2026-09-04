"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Input } from "@/components/ui";

import { modifierBudgetCategorieAction } from "./actions";

/**
 * Champ éditable "Budget alloué" d'une Catégorie — voir CLAUDE.md "Budget
 * partagé par Catégorie". Vide = aucune limite (`budgetAlloue = null`),
 * jamais 0 (un budget de 0 bloquerait tout règlement, ce n'est pas ce que
 * "pas de limite" signifie). Enregistrement explicite (bouton), pas à
 * chaque frappe : une saisie de montant se corrige souvent en cours de
 * route, un enregistrement immédiat par caractère n'aurait aucun sens ici.
 */
export function BudgetAlloueField({
  categorieId,
  budgetAlloue,
}: {
  categorieId: string;
  budgetAlloue: number | null;
}) {
  const [value, setValue] = useState(budgetAlloue != null ? String(budgetAlloue) : "");
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    const trimmed = value.trim();
    if (trimmed === "") {
      startTransition(async () => {
        const result = await modifierBudgetCategorieAction(categorieId, null);
        if (result.status === "success") toast.success(result.message);
        else toast.error(result.message);
      });
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error("Le budget doit être un nombre supérieur à 0, ou vide pour aucune limite.");
      return;
    }

    startTransition(async () => {
      const result = await modifierBudgetCategorieAction(categorieId, parsed);
      if (result.status === "success") toast.success(result.message);
      else toast.error(result.message);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <div className="w-36">
        <Input
          aria-label="Budget alloué (FCFA)"
          type="number"
          inputMode="decimal"
          min="1"
          step="1"
          placeholder="Illimité"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      <Button type="button" variant="secondary" loading={isPending} onClick={handleSave}>
        Enregistrer
      </Button>
    </div>
  );
}

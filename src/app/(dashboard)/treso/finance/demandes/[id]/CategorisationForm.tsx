"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button, Input, Select } from "@/components/ui";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import { IDLE_ACTION_STATE } from "@/lib/validation";

import { categoriserDemandeAction } from "./actions";

interface CategorieOption {
  id: string;
  label: string;
}

interface ObjetOption {
  id: string;
  label: string;
  categorieId: string;
}

/**
 * Filtrage Catégorie -> Objet fait entièrement côté client, sans requête
 * réseau supplémentaire : les objets (peu nombreux, ~une poignée par
 * catégorie) sont chargés une fois par la page serveur et filtrés en
 * mémoire au changement de catégorie — le plus simple qui reste fluide vu
 * le volume de données (9 catégories, quelques objets).
 */
export function CategorisationForm({
  demandeId,
  categories,
  objets,
  initialCategorieId = "",
  initialObjetId = "",
  initialBudget,
}: {
  demandeId: string;
  categories: CategorieOption[];
  objets: ObjetOption[];
  /** Pré-remplissage si la demande a déjà été catégorisée mais reste
   * EN_ATTENTE (Finance peut corriger tant qu'elle n'est pas validée). */
  initialCategorieId?: string;
  initialObjetId?: string;
  initialBudget?: number;
}) {
  const [state, formAction, isPending] = useActionState(categoriserDemandeAction, IDLE_ACTION_STATE);
  const router = useRouter();
  useActionFeedback(state);
  const [categorieId, setCategorieId] = useState(initialCategorieId);

  useEffect(() => {
    if (state.status === "success") {
      // Retour à la liste plutôt que de rester sur un formulaire qui vient
      // de se réinitialiser visuellement (comportement natif après une
      // Server Action réussie) : plus cohérent avec le flux "traiter la
      // file d'attente" de Finance.
      router.push("/treso/finance/demandes");
    }
  }, [state, router]);

  const objetsFiltres = useMemo(
    () => objets.filter((o) => o.categorieId === categorieId),
    [objets, categorieId]
  );

  return (
    <form
      action={formAction}
      className="space-y-5 rounded-lg border border-border bg-surface p-4 sm:p-6"
    >
      <input type="hidden" name="demandeId" value={demandeId} />

      <Select
        name="categorieId"
        label="Catégorie"
        placeholder="Sélectionner une catégorie..."
        required
        defaultValue={initialCategorieId}
        onChange={(e) => setCategorieId(e.target.value)}
        options={categories.map((c) => ({ value: c.id, label: c.label }))}
        error={state.status === "error" ? state.fieldErrors?.categorieId : undefined}
      />

      <Select
        key={categorieId}
        name="objetId"
        label="Objet"
        placeholder={categorieId ? "Sélectionner un objet..." : "Choisir d'abord une catégorie"}
        required
        disabled={!categorieId}
        defaultValue={categorieId === initialCategorieId ? initialObjetId : ""}
        options={objetsFiltres.map((o) => ({ value: o.id, label: o.label }))}
        error={state.status === "error" ? state.fieldErrors?.objetId : undefined}
        hint={
          categorieId && objetsFiltres.length === 0
            ? "Aucun objet n'existe encore pour cette catégorie."
            : undefined
        }
      />

      <Input
        name="budgetDisponible"
        label="Budget disponible (FCFA)"
        type="number"
        inputMode="decimal"
        min="1"
        step="1"
        required
        defaultValue={initialBudget}
        placeholder="Ex: 100000"
        error={state.status === "error" ? state.fieldErrors?.budgetDisponible : undefined}
      />

      <Button type="submit" loading={isPending} className="w-full sm:w-auto">
        Enregistrer la catégorisation
      </Button>
    </form>
  );
}

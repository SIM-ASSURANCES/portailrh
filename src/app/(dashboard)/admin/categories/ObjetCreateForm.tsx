"use client";

import { useActionState } from "react";

import { Button, Input } from "@/components/ui";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import { IDLE_ACTION_STATE } from "@/lib/validation";

import { createObjetAction } from "./actions";

/**
 * Formulaire d'ajout d'un objet sous une catégorie précise (`categorieId`
 * en champ caché) — toujours visible sous chaque catégorie, pas de bouton
 * "ouvrir" : ce n'est qu'un petit formulaire à deux champs, pas besoin de
 * le replier.
 */
export function ObjetCreateForm({ categorieId }: { categorieId: string }) {
  const [state, formAction, isPending] = useActionState(createObjetAction, IDLE_ACTION_STATE);
  useActionFeedback(state);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="categorieId" value={categorieId} />
      <div className="min-w-[200px] flex-1">
        <Input
          name="label"
          label="Nouvel objet"
          required
          error={state.status === "error" ? state.fieldErrors?.label : undefined}
        />
      </div>
      <Button type="submit" variant="secondary" loading={isPending}>
        Ajouter
      </Button>
    </form>
  );
}

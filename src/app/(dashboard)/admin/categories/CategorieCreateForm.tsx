"use client";

import { useActionState } from "react";

import { Button, Input } from "@/components/ui";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import { IDLE_ACTION_STATE } from "@/lib/validation";

import { createCategorieAction } from "./actions";

export function CategorieCreateForm() {
  const [state, formAction, isPending] = useActionState(createCategorieAction, IDLE_ACTION_STATE);
  useActionFeedback(state);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-4 rounded-md border border-border p-4">
      <div className="min-w-[240px] flex-1">
        <Input
          name="label"
          label="Libellé de la nouvelle catégorie"
          required
          error={state.status === "error" ? state.fieldErrors?.label : undefined}
        />
      </div>
      <Button type="submit" loading={isPending}>
        Créer la catégorie
      </Button>
    </form>
  );
}

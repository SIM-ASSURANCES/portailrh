"use client";

import { useActionState } from "react";

import { Button, Input } from "@/components/ui";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import { IDLE_ACTION_STATE } from "@/lib/validation";

import { creerRoleAction } from "./actions";

export function RoleCreateForm() {
  const [state, formAction, isPending] = useActionState(creerRoleAction, IDLE_ACTION_STATE);
  useActionFeedback(state);

  return (
    <form
      action={formAction}
      className="grid grid-cols-1 gap-4 rounded-md border border-border p-4 sm:grid-cols-2"
    >
      <Input
        name="nom"
        label="Nom du rôle"
        required
        error={state.status === "error" ? state.fieldErrors?.nom : undefined}
      />
      <Input
        name="description"
        label="Description"
        hint="Optionnel"
        error={state.status === "error" ? state.fieldErrors?.description : undefined}
      />
      <div className="sm:col-span-2">
        <Button type="submit" loading={isPending}>
          Créer le rôle
        </Button>
      </div>
    </form>
  );
}

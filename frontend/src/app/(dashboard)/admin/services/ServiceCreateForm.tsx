"use client";

import { useActionState } from "react";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import { Button, Input } from "@/components/ui";
import { IDLE_ACTION_STATE } from "backend/client";
import { createServiceAction } from "./actions";

export function ServiceCreateForm() {
  const [state, formAction, isPending] = useActionState(createServiceAction, IDLE_ACTION_STATE);
  useActionFeedback(state);

  return (
    <form
      action={formAction}
      className="grid grid-cols-1 gap-4 rounded-md border border-border p-4 sm:grid-cols-2 md:grid-cols-3"
    >
      <Input
        name="name"
        label="Nom du service"
        required
        error={state.status === "error" ? state.fieldErrors?.name : undefined}
      />
      <Input
        name="description"
        label="Description (optionnelle)"
      />
      <div className="flex items-end">
        <Button type="submit" loading={isPending} className="w-full sm:w-auto">
          Créer le service
        </Button>
      </div>
    </form>
  );
}

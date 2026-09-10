"use client";

import { useActionState } from "react";

import { Button, Input } from "@/components/ui";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import { IDLE_ACTION_STATE } from "backend/client";

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
        {/* Réglable UNIQUEMENT ici, à la création (voir CLAUDE.md
            "estAdmin figé après création") — plus aucune Server Action ne
            permet de le modifier une fois le rôle créé. */}
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            name="estAdmin"
            className="h-4 w-4 rounded border-border accent-primary"
          />
          Accès à l&apos;administration
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          Choix définitif : non modifiable après la création du rôle.
        </p>
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" loading={isPending}>
          Créer le rôle
        </Button>
      </div>
    </form>
  );
}

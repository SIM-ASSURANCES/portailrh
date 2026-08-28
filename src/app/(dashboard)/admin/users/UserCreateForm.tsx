"use client";

import { useActionState } from "react";

import { Button, Input, Select } from "@/components/ui";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import { IDLE_ACTION_STATE } from "@/lib/validation";

import { createUserAction } from "./actions";

export function UserCreateForm({ roles }: { roles: { id: string; name: string }[] }) {
  const [state, formAction, isPending] = useActionState(createUserAction, IDLE_ACTION_STATE);
  useActionFeedback(state);

  return (
    <form
      action={formAction}
      className="grid grid-cols-1 gap-4 rounded-md border border-border p-4 sm:grid-cols-2"
    >
      <Input
        name="fullName"
        label="Nom complet"
        required
        error={state.status === "error" ? state.fieldErrors?.fullName : undefined}
      />
      <Input
        name="email"
        label="Email"
        type="email"
        required
        error={state.status === "error" ? state.fieldErrors?.email : undefined}
      />
      <Input
        name="password"
        label="Mot de passe"
        type="password"
        required
        hint="8 caractères minimum"
        error={state.status === "error" ? state.fieldErrors?.password : undefined}
      />
      <Select
        name="roleId"
        label="Rôle"
        placeholder="Sélectionner..."
        required
        options={roles.map((role) => ({ value: role.id, label: role.name }))}
        error={state.status === "error" ? state.fieldErrors?.roleId : undefined}
      />
      <div className="sm:col-span-2">
        <Button type="submit" loading={isPending}>
          Créer l&apos;utilisateur
        </Button>
      </div>
    </form>
  );
}

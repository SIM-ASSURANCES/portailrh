"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Icon } from "@/components/icons";
import { Button, Input } from "@/components/ui";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import { IDLE_ACTION_STATE } from "backend/client";

import { resetPasswordAction } from "./actions";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState(
    resetPasswordAction,
    IDLE_ACTION_STATE
  );
  useActionFeedback(state);

  return (
    <form action={formAction} className="space-y-4">
      {state.status === "error" && state.message && !state.fieldErrors ? (
        <p className="animate-fade-in flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
          <Icon name="alert-triangle" className="mt-0.5 size-4 shrink-0" />
          {state.message}
        </p>
      ) : null}

      <input type="hidden" name="token" value={token} />

      <Input
        label="Nouveau mot de passe"
        name="password"
        type="password"
        required
        autoComplete="new-password"
        hint="8 caractères minimum (majuscule, minuscule, chiffre, symbole)"
        error={state.status === "error" ? state.fieldErrors?.password : undefined}
      />

      <Input
        label="Confirmer le nouveau mot de passe"
        name="passwordConfirmation"
        type="password"
        required
        autoComplete="new-password"
        error={state.status === "error" ? state.fieldErrors?.passwordConfirmation : undefined}
      />

      <Button type="submit" className="w-full" loading={isPending}>
        Modifier mon mot de passe
      </Button>

      <div className="pt-2 text-center">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <Icon name="arrow-left" className="size-4" />
          Retour à la connexion
        </Link>
      </div>
    </form>
  );
}

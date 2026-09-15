"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Icon } from "@/components/icons";
import { Button, Input } from "@/components/ui";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import { IDLE_ACTION_STATE } from "backend/client";

import { requestPasswordResetAction } from "./actions";

export function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(
    requestPasswordResetAction,
    IDLE_ACTION_STATE
  );
  useActionFeedback(state);

  if (state.status === "success") {
    return (
      <div className="space-y-4">
        <div className="animate-fade-in flex items-start gap-3 rounded-lg border border-success-border bg-success-bg p-4 text-sm text-success">
          <Icon name="check-circle" className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-medium text-foreground">Demande prise en compte</p>
            <p className="mt-1 text-muted-foreground">{state.message}</p>
          </div>
        </div>

        <div className="pt-2 text-center">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <Icon name="arrow-left" className="size-4" />
            Retourner à la page de connexion
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {state.status === "error" && state.message && !state.fieldErrors ? (
        <p className="animate-fade-in flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
          <Icon name="alert-triangle" className="mt-0.5 size-4 shrink-0" />
          {state.message}
        </p>
      ) : null}

      <Input
        label="Adresse email"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="prenom.nom@sim-assurances.ci"
        error={state.status === "error" ? state.fieldErrors?.email : undefined}
      />

      <Button type="submit" className="w-full" loading={isPending}>
        Envoyer le lien de réinitialisation
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

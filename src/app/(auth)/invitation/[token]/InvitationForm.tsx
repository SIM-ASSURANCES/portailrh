"use client";

import { useActionState } from "react";

import { Button, Input } from "@/components/ui";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import { IDLE_ACTION_STATE } from "@/lib/validation";

import { activerInvitationAction } from "./actions";

/**
 * Formulaire de finalisation d'un compte invité par lien. En cas de
 * succès, la Server Action redirige elle-même vers `/login` (jamais un
 * état "success" affiché ici) — `useActionFeedback` ne réagit donc en
 * pratique qu'aux erreurs sur cette page.
 */
export function InvitationForm({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState(activerInvitationAction, IDLE_ACTION_STATE);
  useActionFeedback(state);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <Input
        label="Mot de passe"
        name="password"
        type="password"
        required
        autoComplete="new-password"
        hint="8 caractères minimum"
        error={state.status === "error" ? state.fieldErrors?.password : undefined}
      />
      <Input
        label="Confirmer le mot de passe"
        name="passwordConfirmation"
        type="password"
        required
        autoComplete="new-password"
        error={state.status === "error" ? state.fieldErrors?.passwordConfirmation : undefined}
      />
      <Button type="submit" className="w-full" loading={isPending}>
        Activer mon compte
      </Button>
    </form>
  );
}

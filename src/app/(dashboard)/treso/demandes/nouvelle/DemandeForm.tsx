"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { Button, FormField, Input, Textarea } from "@/components/ui";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import { IDLE_ACTION_STATE } from "@/lib/validation";

import { creerDemandeAction } from "./actions";

export function DemandeForm() {
  const [state, formAction, isPending] = useActionState(creerDemandeAction, IDLE_ACTION_STATE);
  const router = useRouter();
  useActionFeedback(state);

  useEffect(() => {
    if (state.status === "success") {
      router.push("/treso/demandes");
    }
  }, [state, router]);

  return (
    <form
      action={formAction}
      className="space-y-5 rounded-lg border border-border bg-surface p-4 sm:p-6"
    >
      <Input
        name="montant"
        label="Montant (FCFA)"
        type="number"
        inputMode="decimal"
        min="1"
        step="1"
        required
        placeholder="Ex: 50000"
        error={state.status === "error" ? state.fieldErrors?.montant : undefined}
      />
      <Textarea
        name="description"
        label="Description du besoin"
        required
        rows={4}
        placeholder="Décrivez précisément votre besoin..."
        error={state.status === "error" ? state.fieldErrors?.description : undefined}
      />
      <Textarea
        name="commentaire"
        label="Commentaire"
        rows={3}
        hint="Optionnel"
        error={state.status === "error" ? state.fieldErrors?.commentaire : undefined}
      />
      <FormField
        label="Pièce jointe"
        hint="Import de fichiers à venir — le stockage de fichiers n'est pas encore configuré dans le projet."
      >
        <input
          type="file"
          disabled
          aria-disabled="true"
          className="block w-full cursor-not-allowed rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
        />
      </FormField>
      <Button type="submit" loading={isPending} className="w-full sm:w-auto">
        Envoyer la demande
      </Button>
    </form>
  );
}

"use client";

import { useState, useTransition } from "react";

import { Button, Input } from "@/components/ui";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import { IDLE_ACTION_STATE, type ActionState } from "backend/client";

import { modifierNomUtilisateurAction } from "./actions";

/**
 * Nom d'un compte, modifiable en place (Admin seul, revérifié dans l'action) : bouton « Modifier » → champ avec
 * Enregistrer / Annuler. Erreur sous le champ, toast de succès. Même rendu en tableau (bureau) et en carte (mobile).
 */
export function UserNameEditor({ userId, fullName }: { userId: string; fullName: string }) {
  const [ouvert, setOuvert] = useState(false);
  const [valeur, setValeur] = useState(fullName);
  const [state, setState] = useState<ActionState>(IDLE_ACTION_STATE);
  const [isPending, startTransition] = useTransition();
  useActionFeedback(state);

  function enregistrer() {
    startTransition(async () => {
      const res = await modifierNomUtilisateurAction(userId, valeur);
      setState(res);
      if (res.status === "success") setOuvert(false);
    });
  }

  if (!ouvert) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span>{fullName}</span>
        <button
          type="button"
          className="text-xs font-medium text-info underline-offset-4 hover:text-primary hover:underline"
          aria-label={`Modifier le nom de ${fullName}`}
          onClick={() => {
            setValeur(fullName);
            setState(IDLE_ACTION_STATE);
            setOuvert(true);
          }}
        >
          Modifier
        </button>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-2 text-left">
      <Input
        aria-label={`Nom de ${fullName}`}
        value={valeur}
        maxLength={150}
        onChange={(e) => {
          setValeur(e.target.value);
          if (state.status === "error") setState(IDLE_ACTION_STATE);
        }}
        error={state.status === "error" ? state.fieldErrors?.nom : undefined}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" loading={isPending} onClick={enregistrer}>
          Enregistrer
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={isPending}
          onClick={() => {
            setOuvert(false);
            setState(IDLE_ACTION_STATE);
          }}
        >
          Annuler
        </Button>
      </div>
    </div>
  );
}

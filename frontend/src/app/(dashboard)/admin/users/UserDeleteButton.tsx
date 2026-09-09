"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui";

import { supprimerUtilisateurAction } from "./actions";

/**
 * Bouton "Supprimer" — suppression DÉFINITIVE, jamais possible si le
 * compte a la moindre donnée réelle liée (voir supprimerUtilisateurAction
 * et CLAUDE.md). Volontairement à deux temps ("Supprimer" révèle
 * "Confirmer la suppression"/"Annuler", même principe que
 * ClotureActions.tsx) : jamais une suppression définitive à un seul clic
 * accidentel.
 */
export function UserDeleteButton({ userId }: { userId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await supprimerUtilisateurAction(userId);
      if (result.status === "success") {
        toast.success(result.message);
        setConfirming(false);
      } else {
        // Message précis de la Server Action (ex: ce qui bloque exactement
        // la suppression) — jamais une erreur générique.
        toast.error(result.message);
      }
    });
  }

  if (!confirming) {
    return (
      <Button type="button" variant="danger" onClick={() => setConfirming(true)}>
        Supprimer
      </Button>
    );
  }

  return (
    <div className="animate-fade-in-up flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">Confirmer ?</span>
      <Button type="button" variant="danger" loading={isPending} onClick={handleConfirm}>
        Confirmer la suppression
      </Button>
      <Button type="button" variant="secondary" disabled={isPending} onClick={() => setConfirming(false)}>
        Annuler
      </Button>
    </div>
  );
}

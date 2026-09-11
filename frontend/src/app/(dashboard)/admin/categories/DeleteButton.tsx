"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui";

type DeleteResult = { status: "success" | "error"; message: string };

/**
 * Bouton "Supprimer" générique (Catégorie ET Objet, `deleteAction` en prop
 * plutôt qu'importé en dur — même principe que `ActiveToggleButton.tsx`),
 * suppression DÉFINITIVE. À deux temps ("Supprimer" révèle "Confirmer la
 * suppression"/"Annuler"), même pattern que `UserDeleteButton.tsx`
 * (admin/users) : jamais un seul clic accidentel. Un refus serveur affiche
 * le message précis dans un toast d'erreur et laisse le panneau de
 * confirmation ouvert, un succès le referme.
 */
export function DeleteButton({
  id,
  deleteAction,
}: {
  id: string;
  deleteAction: (id: string) => Promise<DeleteResult>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await deleteAction(id);
      if (result.status === "success") {
        toast.success(result.message);
        setConfirming(false);
      } else {
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

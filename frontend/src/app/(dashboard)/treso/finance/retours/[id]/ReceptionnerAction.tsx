"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui";

import { receptionnerRetourAction } from "../retourActions";

/**
 * Bouton "Réceptionner" — déplacé depuis la liste "Retours en attente" sur
 * cet écran de détail (Tâche "Écran 'Voir' avant 'Réceptionner'", voir
 * CLAUDE.md) : n'est plus jamais actionnable directement depuis la liste,
 * uniquement après consultation du détail complet du retour.
 *
 * **`disabled`** — même convention que partout ailleurs dans le module
 * (Responsable Finance en lecture seule) : reste visible, jamais masqué.
 */
export function ReceptionnerAction({ retourId, disabled = false }: { retourId: string; disabled?: boolean }) {
  const [isPending, startTransition] = useTransition();

  function handleReceptionner() {
    startTransition(async () => {
      const result = await receptionnerRetourAction(retourId);
      if (result.status === "success") {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <Button type="button" loading={isPending} disabled={disabled} onClick={handleReceptionner}>
      Réceptionner
    </Button>
  );
}

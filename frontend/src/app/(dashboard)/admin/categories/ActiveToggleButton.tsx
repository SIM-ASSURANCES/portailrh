"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui";

type ToggleResult = { status: "success" | "error"; message: string };

/**
 * Bouton Activer/Désactiver générique — même pattern que
 * `ModuleActiveToggle.tsx` (admin/modules), généralisé ici pour être
 * partagé entre les lignes Catégorie ET Objet de cette page (`toggleAction`
 * en prop plutôt qu'importé en dur, seule vraie différence entre les deux
 * usages).
 */
export function ActiveToggleButton({
  id,
  isActive,
  toggleAction,
}: {
  id: string;
  isActive: boolean;
  toggleAction: (id: string, active: boolean) => Promise<ToggleResult>;
}) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await toggleAction(id, !isActive);
      if (result.status === "success") {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <Button type="button" variant={isActive ? "danger" : "secondary"} loading={isPending} onClick={handleClick}>
      {isActive ? "Désactiver" : "Activer"}
    </Button>
  );
}

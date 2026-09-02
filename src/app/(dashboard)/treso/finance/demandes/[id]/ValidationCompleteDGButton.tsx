"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui";

import { approuverValidationCompleteAction } from "./actions";

/**
 * Bouton "Approuver la validation complète" — verrou de clôture (Ticket 7),
 * réservé (au niveau de la page appelante) à `treso.approuver_validation_complete`
 * (DG uniquement selon le seed). N'apparaît que si la demande n'est pas
 * encore approuvée — aucune action de "retrait" n'existe, même principe que
 * l'absence de "dévalidation" ailleurs dans le module.
 */
export function ValidationCompleteDGButton({ demandeId }: { demandeId: string }) {
  const [isPending, startTransition] = useTransition();

  function handleApprouver() {
    startTransition(async () => {
      const result = await approuverValidationCompleteAction(demandeId);
      if (result.status === "success") {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <Button type="button" loading={isPending} onClick={handleApprouver}>
      Approuver la validation complète
    </Button>
  );
}

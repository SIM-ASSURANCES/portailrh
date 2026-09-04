"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui";

import { regenererInvitationAction } from "./actions";

/**
 * Régénère le lien d'invitation d'un compte en attente d'activation (ex:
 * l'ancien a expiré) — voir CLAUDE.md "Invitation par lien". Le nouveau
 * lien est copié automatiquement dans le presse-papiers au succès : la
 * ligne du tableau n'a pas la place d'afficher le lien complet comme le
 * fait le formulaire de création (`InvitationCreateForm`).
 */
export function RegenererInvitationButton({ userId }: { userId: string }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await regenererInvitationAction(userId);
      if (result.status === "success") {
        toast.success(result.message);
        if (result.data?.invitationUrl) {
          navigator.clipboard
            .writeText(result.data.invitationUrl)
            .then(() => toast.info("Nouveau lien copié dans le presse-papiers."))
            .catch(() => {
              /* Copie silencieusement ignorée si le presse-papiers est indisponible — le succès de la régénération reste acquis. */
            });
        }
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <Button type="button" variant="secondary" loading={isPending} onClick={handleClick}>
      Régénérer le lien
    </Button>
  );
}

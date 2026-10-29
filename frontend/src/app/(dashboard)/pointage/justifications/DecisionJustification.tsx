"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button, Textarea } from "@/components/ui";
import { accepterJustificationAction, refuserJustificationAction } from "./actions";

const MOTIF_REFUS_MIN = 3;

/** Accepter, ou refuser avec un motif obligatoire (revérifié côté serveur). */
export function DecisionJustification({ justificationId }: { justificationId: string }) {
  const [refusOuvert, setRefusOuvert] = useState(false);
  const [motifRefus, setMotifRefus] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const longueur = motifRefus.trim().length;

  const executer = (action: () => ReturnType<typeof accepterJustificationAction>) => {
    startTransition(async () => {
      const resultat = await action();
      if (resultat.status === "success") {
        toast.success(resultat.message ?? "Décision enregistrée.");
        router.refresh();
      } else if (resultat.status === "error") {
        toast.error(resultat.message);
      }
    });
  };

  if (refusOuvert) {
    return (
      <div className="space-y-3 border-t border-border pt-3">
        <Textarea
          label="Motif du rejet"
          required
          rows={3}
          maxLength={500}
          value={motifRefus}
          onChange={(e) => setMotifRefus(e.target.value)}
          error={longueur > 0 && longueur < MOTIF_REFUS_MIN ? `${MOTIF_REFUS_MIN} caractères minimum.` : undefined}
          hint="Le collaborateur verra ce motif."
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="danger"
            loading={isPending}
            disabled={longueur < MOTIF_REFUS_MIN}
            onClick={() => executer(() => refuserJustificationAction(justificationId, motifRefus))}
          >
            Confirmer le rejet
          </Button>
          <Button variant="secondary" disabled={isPending} onClick={() => setRefusOuvert(false)}>
            Annuler
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row">
      <Button variant="primary" loading={isPending} onClick={() => executer(() => accepterJustificationAction(justificationId))}>
        Accepter
      </Button>
      <Button variant="danger" disabled={isPending} onClick={() => setRefusOuvert(true)}>
        Rejeter
      </Button>
    </div>
  );
}

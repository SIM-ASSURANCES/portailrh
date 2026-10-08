"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui";

import { ajouterQuandMemeAction } from "./actions";

/** « Ajouter quand même » (doublon possible) : confirmation en deux temps, le paiement créé reste « à confirmer ». */
export function AjouterQuandMemeButton({ signalementId }: { signalementId: string }) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [enCours, startTransition] = useTransition();

  if (!ouvert) {
    return (
      <Button variant="secondary" type="button" onClick={() => setOuvert(true)}>
        Ajouter quand même
      </Button>
    );
  }

  function confirmer() {
    startTransition(async () => {
      const resultat = await ajouterQuandMemeAction(signalementId);
      if (resultat.status === "success") {
        toast.success(resultat.message);
        setOuvert(false);
        router.refresh();
      } else {
        toast.error(resultat.message);
      }
    });
  }

  return (
    <div className="w-64 max-w-full space-y-2 text-sm">
      <p className="text-muted-foreground">Créer ce paiement « à confirmer » à partir de la ligne du fichier ?</p>
      <div className="flex gap-2">
        <Button type="button" onClick={confirmer} loading={enCours}>
          Confirmer l&apos;ajout
        </Button>
        <Button variant="secondary" type="button" onClick={() => setOuvert(false)} disabled={enCours}>
          Annuler
        </Button>
      </div>
    </div>
  );
}

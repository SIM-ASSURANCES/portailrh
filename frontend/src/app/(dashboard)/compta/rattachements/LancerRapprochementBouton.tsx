"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui";

import { lancerRapprochementCptAction } from "./actions";

/**
 * « Lancer le rapprochement » (lot GC-5d) : le moteur propose des rattachements pour les encaissements qui n'en ont pas encore.
 * Cela ne rattache rien : une prime n'est payée qu'après la validation du RFCRH.
 */
export function LancerRapprochementBouton() {
  const router = useRouter();
  const [enCours, startTransition] = useTransition();

  function lancer() {
    startTransition(async () => {
      const r = await lancerRapprochementCptAction();
      if (r.status === "error") toast.error(r.message);
      else toast.success(r.message);
      router.refresh();
    });
  }

  return (
    <Button type="button" onClick={lancer} loading={enCours} disabled={enCours} data-rapprochement-lancer>
      Lancer le rapprochement
    </Button>
  );
}

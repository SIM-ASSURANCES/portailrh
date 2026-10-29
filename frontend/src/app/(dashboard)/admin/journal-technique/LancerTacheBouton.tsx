"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui";
import type { NomTache } from "backend";

import { lancerTacheAction } from "./actions";

export function LancerTacheBouton({ tache }: { tache: NomTache }) {
  const [enCours, demarrer] = useTransition();
  const router = useRouter();

  return (
    <Button
      type="button"
      variant="secondary"
      loading={enCours}
      onClick={() =>
        demarrer(async () => {
          const etat = await lancerTacheAction(tache);
          if (etat.status === "success") toast.success(etat.message ?? "Tâche exécutée.");
          else if (etat.status === "error") toast.error(etat.message);
          router.refresh();
        })
      }
    >
      Lancer maintenant
    </Button>
  );
}

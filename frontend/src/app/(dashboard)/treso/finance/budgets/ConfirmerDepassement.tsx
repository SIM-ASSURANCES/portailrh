"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ChampMotifEchange, motifEchangeValide } from "@/components/tresorerie/ChampMotifEchange";
import { Button } from "@/components/ui";

import { confirmerDepassementBudgetAction } from "./actions";

/** Le DG confirme un dépassement du seuil rouge demandé par la Finance (motif obligatoire, 10 à 300 caractères). */
export function ConfirmerDepassement({ id }: { id: string }) {
  const [motif, setMotif] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <div data-confirmer-depassement className="flex flex-wrap items-end gap-2">
      <div className="w-80">
        <ChampMotifEchange name="motifDepassement" label="Motif de la confirmation" hint="Tracé dans l'historique." value={motif} onChange={setMotif} />
      </div>
      <Button signe
        type="button"
        loading={isPending}
        disabled={!motifEchangeValide(motif)}
        onClick={() =>
          startTransition(async () => {
            const r = await confirmerDepassementBudgetAction(id, motif.trim());
            if (r.status === "success") {
              toast.success(r.message);
              setMotif("");
            } else toast.error(r.message);
          })
        }
      >
        Confirmer le dépassement
      </Button>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Input } from "@/components/ui";

import { deciderParametragesBudgetAction } from "./actions";

/** Le DG valide ou refuse (motif obligatoire) UN paramétrage de budget soumis par la Finance (décision seule ; voir `ParametragesEnAttente` pour le lot). */
export function DecisionParametrage({ id, desactive, raison }: { id: string; desactive?: boolean; raison?: string }) {
  const [refus, setRefus] = useState(false);
  const [motif, setMotif] = useState("");
  const [isPending, startTransition] = useTransition();

  function decider(valider: boolean) {
    startTransition(async () => {
      const r = await deciderParametragesBudgetAction([{ id }], valider, valider ? undefined : motif);
      if (r.status === "success") toast.success(r.message);
      else toast.error(r.message);
    });
  }

  return (
    <div data-decision-parametrage className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" loading={isPending} disabled={desactive || isPending} data-valider-parametrage onClick={() => decider(true)}>
          Valider
        </Button>
        <Button type="button" variant="danger" disabled={desactive || isPending} data-refuser-parametrage onClick={() => setRefus((v) => !v)}>
          Refuser
        </Button>
      </div>
      {desactive && raison ? <p className="text-xs text-muted-foreground">{raison}</p> : null}
      {refus && !desactive ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-72">
            <Input name="motifRefus" label="Motif du refus" required value={motif} onChange={(e) => setMotif(e.target.value)} hint="3 caractères minimum." />
          </div>
          <Button type="button" variant="danger" loading={isPending} disabled={motif.trim().length < 3} data-confirmer-refus onClick={() => decider(false)}>
            Confirmer le refus
          </Button>
        </div>
      ) : null}
    </div>
  );
}

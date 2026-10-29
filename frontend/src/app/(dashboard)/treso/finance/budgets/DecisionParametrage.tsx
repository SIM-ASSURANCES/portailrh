"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ChampMotifEchange, motifEchangeValide } from "@/components/tresorerie/ChampMotifEchange";
import { Button } from "@/components/ui";

import { deciderBudgetsCategoriesAction, deciderSeuilsCaisseAction } from "./actions";

/**
 * Le DG valide ou rejette UN paramétrage de budget soumis par la Finance (décision seule ; voir `ParametragesEnAttente` pour le lot).
 * Lot M : le motif (10 à 300 caractères) est obligatoire pour VALIDER comme pour REJETER ; le champ est toujours visible et les
 * deux boutons restent grisés tant qu'il n'est pas valable. L'action appelée dépend de la section (lot J quater).
 */
export function DecisionParametrage({ id, portee, desactive, raison }: { id: string; portee: "GLOBAL" | "CATEGORIE"; desactive?: boolean; raison?: string }) {
  const [motif, setMotif] = useState("");
  const [isPending, startTransition] = useTransition();
  const motifOk = motifEchangeValide(motif);

  function decider(valider: boolean) {
    startTransition(async () => {
      const decideur = portee === "GLOBAL" ? deciderSeuilsCaisseAction : deciderBudgetsCategoriesAction;
      const r = await decideur([{ id }], valider, motif.trim());
      if (r.status === "success") {
        toast.success(r.message);
        setMotif("");
      } else toast.error(r.message);
    });
  }

  return (
    <div data-decision-parametrage className="space-y-2">
      {!desactive ? (
        <div className="max-w-md">
          <ChampMotifEchange name={`motifDecision-${id}`} label="Motif de la décision du DG" hint="Transmis à la Finance." value={motif} onChange={setMotif} disabled={isPending} />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button signe type="button" loading={isPending} disabled={desactive || isPending || !motifOk} data-valider-parametrage onClick={() => decider(true)}>
          Valider
        </Button>
        <Button signe type="button" variant="danger" disabled={desactive || isPending || !motifOk} data-refuser-parametrage onClick={() => decider(false)}>
          Rejeter
        </Button>
      </div>
      {desactive && raison ? <p className="text-xs text-muted-foreground">{raison}</p> : null}
    </div>
  );
}

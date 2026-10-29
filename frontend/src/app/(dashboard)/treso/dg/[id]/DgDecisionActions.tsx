"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ChampMotifEchange } from "@/components/tresorerie/ChampMotifEchange";
import { Button } from "@/components/ui";
import { motifEchangeValide } from "backend/client";

import { rejeterDemandeEtapeDGAction, rejeterEtapeDGAction, validerEtapeDGAction } from "../../circuit/actions";

/**
 * Décision du DG (commit 4). Demande soumise par la Finance : « Valider » (vaut son approbation de clôture ; la
 * Finance prend la décision finale) ou « Rejeter » (motif obligatoire ; retour à la Finance). Demande émise par la
 * Finance (cas b) : la décision se prend ligne par ligne au-dessus ; seul « Rejeter la demande » (motif obligatoire,
 * renvoi au demandeur) est ici. Toujours visibles ; grisés hors de l'étape DG avec la phrase du moteur.
 */
export function DgDecisionActions({
  demandeId,
  decisionParLigne,
  raisonValider,
  raisonRejeter,
}: {
  demandeId: string;
  /** Cas b : la décision se prend ligne par ligne (pas de « Valider » de la demande entière). */
  decisionParLigne: boolean;
  raisonValider: string | null;
  raisonRejeter: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  // Lot M : la validation comme le rejet du DG portent un motif (10 à 300 caractères), transmis à la Finance (ou au demandeur, cas b).
  const [motif, setMotif] = useState("");
  const motifValide = motifEchangeValide(motif);

  function lancer(appel: () => Promise<{ status: string; message: string }>) {
    startTransition(async () => {
      const r = await appel();
      if (r.status === "success") {
        toast.success(r.message);
        setMotif("");
      } else {
        toast.error(r.message);
      }
    });
  }

  const raison = decisionParLigne ? raisonRejeter : (raisonValider ?? raisonRejeter);

  return (
    <section aria-label="Décision du DG" className="space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-elevated sm:p-6">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Votre décision</h2>
      <ChampMotifEchange
        value={motif}
        onChange={setMotif}
        label={decisionParLigne ? "Motif de votre décision (transmis au demandeur)" : "Motif de votre décision (transmis à la Finance)"}
        hint="Obligatoire pour valider comme pour rejeter."
        disabled={!!raisonRejeter && !!raisonValider}
      />
      <div className="flex flex-wrap gap-2">
        {!decisionParLigne ? (
          <Button signe
            type="button"
            disabled={!!raisonValider || isPending || !motifValide}
            loading={isPending}
            onClick={() => lancer(() => validerEtapeDGAction(demandeId, motif))}
          >
            Valider
          </Button>
        ) : null}
        <Button signe
          type="button"
          variant="danger"
          disabled={!!raisonRejeter || isPending || !motifValide}
          onClick={() =>
            lancer(() =>
              decisionParLigne ? rejeterDemandeEtapeDGAction(demandeId, motif) : rejeterEtapeDGAction(demandeId, motif)
            )
          }
        >
          {decisionParLigne ? "Rejeter la demande" : "Rejeter"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {decisionParLigne
          ? "Un rejet renvoie la demande au demandeur, qui pourra la corriger et la resoumettre, ou l'abandonner."
          : "Un rejet renvoie la demande à la Finance, qui pourra la resoumettre ou la renvoyer au demandeur."}
      </p>

      {raison ? (
        <p className="text-xs text-muted-foreground">{raison}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {decisionParLigne
            ? "Votre décision ligne par ligne est finale et vaut votre approbation de clôture."
            : "En validant, vous approuvez aussi la clôture de cette demande ; la Finance prend ensuite la décision finale."}
        </p>
      )}
    </section>
  );
}

"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Textarea } from "@/components/ui";

import { rejeterDemandeEtapeDGAction, rejeterEtapeDGAction, validerEtapeDGAction } from "../../circuit/actions";

const MOTIF_MIN = 3;

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
  const [rejetOuvert, setRejetOuvert] = useState(false);
  const [motif, setMotif] = useState("");
  const motifValide = motif.trim().length >= MOTIF_MIN;

  function lancer(appel: () => Promise<{ status: string; message: string }>) {
    startTransition(async () => {
      const r = await appel();
      if (r.status === "success") {
        toast.success(r.message);
        setRejetOuvert(false);
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
      <div className="flex flex-wrap gap-2">
        {!decisionParLigne ? (
          <Button
            type="button"
            disabled={!!raisonValider || isPending}
            loading={isPending && !rejetOuvert}
            onClick={() => lancer(() => validerEtapeDGAction(demandeId))}
          >
            Valider
          </Button>
        ) : null}
        <Button
          type="button"
          variant="danger"
          disabled={!!raisonRejeter || isPending}
          onClick={() => setRejetOuvert((v) => !v)}
        >
          {decisionParLigne ? "Rejeter la demande" : "Rejeter"}
        </Button>
      </div>

      {rejetOuvert && !raisonRejeter ? (
        <div className="space-y-2">
          <Textarea
            label={decisionParLigne ? "Motif du rejet (transmis au demandeur)" : "Motif du rejet (transmis à la Finance)"}
            required
            rows={3}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            error={motif.length > 0 && !motifValide ? `${MOTIF_MIN} caractères minimum.` : undefined}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="danger"
              disabled={!motifValide || isPending}
              loading={isPending}
              onClick={() =>
                lancer(() =>
                  decisionParLigne ? rejeterDemandeEtapeDGAction(demandeId, motif) : rejeterEtapeDGAction(demandeId, motif)
                )
              }
            >
              Confirmer le rejet
            </Button>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => setRejetOuvert(false)}>
              Annuler
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {decisionParLigne
              ? "La demande retourne au demandeur, qui pourra la corriger et la resoumettre, ou l'abandonner."
              : "La demande retourne à la Finance, qui pourra la resoumettre ou la renvoyer au demandeur."}
          </p>
        </div>
      ) : null}

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

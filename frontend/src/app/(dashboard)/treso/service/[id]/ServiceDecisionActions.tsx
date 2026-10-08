"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Textarea } from "@/components/ui";

import { rejeterEtapeServiceAction, validerEtapeServiceAction } from "../../circuit/actions";

const MOTIF_MIN = 3;

/**
 * Décision du responsable de service à l'étape Service (commit 4) : Valider, ou Rejeter avec un motif d'au moins
 * 3 caractères (la demande retourne au demandeur pour correction). Toujours visibles ; grisés hors de l'étape avec la
 * phrase du moteur (`raisonIndisponible`) — le serveur refuse de toute façon.
 */
export function ServiceDecisionActions({
  demandeId,
  raisonValider,
  raisonRejeter,
}: {
  demandeId: string;
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

  return (
    <section aria-label="Décision du responsable de service" className="space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-elevated sm:p-6">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Votre décision</h2>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={!!raisonValider || isPending}
          loading={isPending && !rejetOuvert}
          onClick={() => lancer(() => validerEtapeServiceAction(demandeId))}
        >
          Valider
        </Button>
        <Button
          type="button"
          variant="danger"
          disabled={!!raisonRejeter || isPending}
          onClick={() => setRejetOuvert((v) => !v)}
        >
          Rejeter
        </Button>
      </div>

      {rejetOuvert && !raisonRejeter ? (
        <div className="space-y-2">
          <Textarea
            label="Motif du rejet (transmis au demandeur)"
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
              onClick={() => lancer(() => rejeterEtapeServiceAction(demandeId, motif))}
            >
              Confirmer le rejet
            </Button>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => setRejetOuvert(false)}>
              Annuler
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            La demande retourne au demandeur, qui pourra la corriger et la resoumettre, ou l&apos;abandonner.
          </p>
        </div>
      ) : null}

      {raisonValider ?? raisonRejeter ? (
        <p className="text-xs text-muted-foreground">{raisonValider ?? raisonRejeter}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          En validant, la demande passe à l&apos;étape Finance.
        </p>
      )}
    </section>
  );
}

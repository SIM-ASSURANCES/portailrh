"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Input, Textarea } from "@/components/ui";

import { rejeterDemandeAction, validerPartiellementAction, validerTotalementAction } from "./actions";

type Mode = "idle" | "confirm-totale" | "partielle" | "rejeter";

/**
 * Décision Finance/DG sur une demande `EN_ATTENTE_VALIDATION` : Valider
 * totalement, Valider partiellement (montant inférieur au montant
 * demandé), ou Rejeter. Réservés (au niveau de la page appelante) aux
 * utilisateurs ayant `treso.valider_demande`.
 *
 * REFONTE V1 / Phase B (voir CLAUDE.md "Refonte V1 en cours") : remplace
 * l'ancien bouton unique "Valider" (Ticket 3) par ces trois issues. La
 * validation partielle amène la demande en `PARTIELLEMENT_VALIDEE`, avec sa
 * propre UI de "validation complémentaire" (voir
 * `ValidationComplementaireActions`), affichée à la place de ce composant
 * une fois la demande partiellement validée.
 *
 * Après succès, la page se met à jour automatiquement : la Server Action
 * appelle `revalidatePath()`, ce que Next.js répercute sur ce composant
 * sans navigation ni `router.refresh()` explicite.
 */
export function ValidationActions({
  demandeId,
  montantDemande,
}: {
  demandeId: string;
  montantDemande: number;
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [montantPartiel, setMontantPartiel] = useState("");
  const [montantError, setMontantError] = useState<string | undefined>();
  const [motif, setMotif] = useState("");
  const [motifError, setMotifError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  function handleValiderTotalement() {
    startTransition(async () => {
      const result = await validerTotalementAction(demandeId);
      if (result.status === "success") {
        toast.success(result.message);
        setMode("idle");
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleValiderPartiellement() {
    const montant = Number(montantPartiel);
    if (!montant || montant <= 0) {
      setMontantError("Le montant doit être supérieur à 0.");
      return;
    }
    if (montant >= montantDemande) {
      setMontantError(
        `Le montant doit être inférieur au montant demandé (${montantDemande.toLocaleString("fr-FR")} FCFA) — utilisez "Valider totalement" sinon.`
      );
      return;
    }
    setMontantError(undefined);
    startTransition(async () => {
      const result = await validerPartiellementAction(demandeId, montant);
      if (result.status === "success") {
        toast.success(result.message);
        setMode("idle");
        setMontantPartiel("");
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleRejeter() {
    if (motif.trim().length < 3) {
      setMotifError("Le motif du rejet est obligatoire (3 caractères minimum).");
      return;
    }
    setMotifError(undefined);
    startTransition(async () => {
      const result = await rejeterDemandeAction(demandeId, motif);
      if (result.status === "success") {
        toast.success(result.message);
        setMode("idle");
        setMotif("");
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold text-foreground">Décision</h2>

      {mode === "idle" ? (
        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={() => setMode("confirm-totale")}>
            Valider totalement
          </Button>
          <Button type="button" variant="secondary" onClick={() => setMode("partielle")}>
            Valider partiellement
          </Button>
          <Button type="button" variant="danger" onClick={() => setMode("rejeter")}>
            Rejeter
          </Button>
        </div>
      ) : null}

      {mode === "confirm-totale" ? (
        <div className="animate-fade-in-up space-y-3">
          <p className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning">
            Confirmer la validation totale ({montantDemande.toLocaleString("fr-FR")} FCFA) ? Le montant
            validé ne pourra plus être réduit ensuite, par personne.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button type="button" loading={isPending} onClick={handleValiderTotalement}>
              Confirmer la validation totale
            </Button>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => setMode("idle")}>
              Annuler
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "partielle" ? (
        <div className="animate-fade-in-up space-y-3">
          <Input
            label="Montant validé"
            type="number"
            required
            hint={`Montant demandé : ${montantDemande.toLocaleString("fr-FR")} FCFA`}
            value={montantPartiel}
            onChange={(e) => {
              setMontantPartiel(e.target.value);
              if (montantError) setMontantError(undefined);
            }}
            error={montantError}
          />
          <p className="text-xs text-muted-foreground">
            Le reliquat pourra être validé plus tard par une validation complémentaire.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button type="button" loading={isPending} onClick={handleValiderPartiellement}>
              Confirmer la validation partielle
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isPending}
              onClick={() => {
                setMode("idle");
                setMontantPartiel("");
                setMontantError(undefined);
              }}
            >
              Annuler
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "rejeter" ? (
        <div className="animate-fade-in-up space-y-3">
          <Textarea
            label="Motif du rejet"
            required
            rows={3}
            placeholder="Expliquez pourquoi cette demande est rejetée..."
            value={motif}
            onChange={(e) => {
              setMotif(e.target.value);
              if (motifError) setMotifError(undefined);
            }}
            error={motifError}
          />
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="danger" loading={isPending} onClick={handleRejeter}>
              Confirmer le rejet
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isPending}
              onClick={() => {
                setMode("idle");
                setMotif("");
                setMotifError(undefined);
              }}
            >
              Annuler
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

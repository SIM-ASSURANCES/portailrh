"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Textarea } from "@/components/ui";

import { rejeterDemandeAction, validerDemandeAction } from "./actions";

type Mode = "idle" | "confirm-valider" | "rejeter";

/**
 * Boutons Valider / Rejeter d'une demande EN_ATTENTE. Réservés (au niveau
 * de la page appelante) aux utilisateurs ayant `treso.valider_demande`.
 *
 * Validation = verrouillage définitif : une confirmation explicite est
 * demandée avant d'exécuter (pas d'annulation possible ensuite, par
 * personne). Rejet = motif obligatoire, saisi avant confirmation.
 *
 * Après succès, la page se met à jour automatiquement : la Server Action
 * appelle `revalidatePath()`, ce que Next.js répercute sur ce composant
 * sans navigation ni `router.refresh()` explicite.
 */
export function ValidationActions({ demandeId }: { demandeId: string }) {
  const [mode, setMode] = useState<Mode>("idle");
  const [motif, setMotif] = useState("");
  const [motifError, setMotifError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  function handleValider() {
    startTransition(async () => {
      const result = await validerDemandeAction(demandeId);
      if (result.status === "success") {
        toast.success(result.message);
        setMode("idle");
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
          <Button type="button" onClick={() => setMode("confirm-valider")}>
            Valider
          </Button>
          <Button type="button" variant="danger" onClick={() => setMode("rejeter")}>
            Rejeter
          </Button>
        </div>
      ) : null}

      {mode === "confirm-valider" ? (
        <div className="space-y-3">
          <p className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning">
            Confirmer la validation ? Cette action est <strong>définitive</strong> : la demande ne
            pourra plus jamais être modifiée ni dévalidée, par personne.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button type="button" loading={isPending} onClick={handleValider}>
              Confirmer la validation
            </Button>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => setMode("idle")}>
              Annuler
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "rejeter" ? (
        <div className="space-y-3">
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

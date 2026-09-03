"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Textarea } from "@/components/ui";

import {
  annulerValidationCompleteAction,
  approuverValidationCompleteAction,
  rejeterValidationCompleteAction,
} from "./actions";

type Mode = "idle" | "rejeter" | "annuler";

/**
 * Actions du verrou de clôture (Ticket 7 / "Validation complète DG"),
 * réservées (au niveau de la page appelante) à
 * `treso.approuver_validation_complete` (DG uniquement selon le seed).
 *
 * Deux usages distincts selon l'état de la demande, sélectionnés par
 * `mode` :
 * - `"examen"` (`validationCompleteParDG = false`) : "Approuver" (direct)
 *   ou "Rejeter" (motif obligatoire — trace purement informative, ne
 *   modifie AUCUN champ de la demande, voir `rejeterValidationCompleteAction`).
 * - `"annulation"` (`validationCompleteParDG = true`) : "Annuler cette
 *   approbation" (motif obligatoire — remet la demande en attente, voir
 *   `annulerValidationCompleteAction`). N'est rendu par la page appelante
 *   que si la demande n'est pas `CLOTUREE` (sinon un message explicatif la
 *   remplace, jamais un bouton voué à échouer côté serveur).
 *
 * Traçabilité impérative ("une histoire d'argent", jamais de suppression) :
 * chaque action crée une nouvelle `HistoriqueEntry` qui s'ajoute à la
 * suite des précédentes, jamais ne les remplace — voir `DemandeHistorique`
 * pour la vue chronologique complète.
 */
export function ValidationCompleteDGActions({
  demandeId,
  mode: usage,
}: {
  demandeId: string;
  mode: "examen" | "annulation";
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [motif, setMotif] = useState("");
  const [motifError, setMotifError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  function handleApprouver() {
    startTransition(async () => {
      const result = await approuverValidationCompleteAction(demandeId);
      if (result.status === "success") {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleRejeter() {
    if (motif.trim().length < 3) {
      setMotifError("Le motif est obligatoire (3 caractères minimum).");
      return;
    }
    setMotifError(undefined);
    startTransition(async () => {
      const result = await rejeterValidationCompleteAction(demandeId, motif);
      if (result.status === "success") {
        toast.success(result.message);
        setMode("idle");
        setMotif("");
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleAnnuler() {
    if (motif.trim().length < 3) {
      setMotifError("Le motif est obligatoire (3 caractères minimum).");
      return;
    }
    setMotifError(undefined);
    startTransition(async () => {
      const result = await annulerValidationCompleteAction(demandeId, motif);
      if (result.status === "success") {
        toast.success(result.message);
        setMode("idle");
        setMotif("");
      } else {
        toast.error(result.message);
      }
    });
  }

  function resetMotif() {
    setMode("idle");
    setMotif("");
    setMotifError(undefined);
  }

  if (usage === "examen") {
    if (mode === "rejeter") {
      return (
        <div className="animate-fade-in-up w-full space-y-3 sm:w-auto">
          <Textarea
            label="Motif du rejet"
            required
            rows={3}
            placeholder="Ce qui doit être corrigé avant un nouvel examen..."
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
            <Button type="button" variant="secondary" disabled={isPending} onClick={resetMotif}>
              Annuler
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-wrap gap-3">
        <Button type="button" loading={isPending} onClick={handleApprouver}>
          Approuver la validation complète
        </Button>
        <Button type="button" variant="danger" disabled={isPending} onClick={() => setMode("rejeter")}>
          Rejeter
        </Button>
      </div>
    );
  }

  // usage === "annulation"
  if (mode === "annuler") {
    return (
      <div className="animate-fade-in-up w-full space-y-3 sm:w-auto">
        <Textarea
          label="Motif de l'annulation"
          required
          rows={3}
          placeholder="Pourquoi cette approbation est-elle annulée ?"
          value={motif}
          onChange={(e) => {
            setMotif(e.target.value);
            if (motifError) setMotifError(undefined);
          }}
          error={motifError}
        />
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="danger" loading={isPending} onClick={handleAnnuler}>
            Confirmer l&apos;annulation
          </Button>
          <Button type="button" variant="secondary" disabled={isPending} onClick={resetMotif}>
            Annuler
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button type="button" variant="danger" onClick={() => setMode("annuler")}>
      Annuler cette approbation
    </Button>
  );
}

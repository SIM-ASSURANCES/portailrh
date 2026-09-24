"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Textarea } from "@/components/ui";

import {
  annulerValidationCompleteAction,
  approuverValidationCompleteAction,
  rejeterValidationCompleteAction,
  resoumettreValidationCompleteDGAction,
} from "./actions";

type Mode = "idle" | "rejeter" | "annuler" | "resoumettre";

/**
 * Actions du verrou de clôture (Ticket 7 / "Validation complète DG"),
 * réservées (au niveau de la page appelante) à
 * `treso.approuver_validation_complete` (DG uniquement selon le seed).
 *
 * Deux usages distincts selon l'état de la demande, sélectionnés par
 * `mode` :
 * - `"examen"` (`validationCompleteParDG = false`) : "Approuver la
 *   validation complète" (direct) ou "Rejeter" (motif obligatoire — trace
 *   purement informative, ne modifie AUCUN champ de la demande, voir
 *   `rejeterValidationCompleteAction`).
 * - `"annulation"` (`validationCompleteParDG = true`) : "Annuler cette
 *   approbation" (motif obligatoire — remet la demande en attente, voir
 *   `annulerValidationCompleteAction`). N'est rendu par la page appelante
 *   que si la demande n'est pas `CLOTUREE` (sinon un message explicatif la
 *   remplace, jamais un bouton voué à échouer côté serveur).
 * - `"resoumission"` (Tâche "Resoumission au DG après rejet", voir
 *   CLAUDE.md) : "Resoumettre au DG" (motif obligatoire, 10 caractères
 *   minimum — voir `resoumettreValidationCompleteDGAction`). Rendu par la
 *   page appelante sous une garde de permission DISTINCTE et opposée à
 *   celle des deux modes ci-dessus (Responsable Finance UNIQUEMENT, jamais
 *   le DG) — les deux gardes ne s'affichent donc jamais en même temps pour
 *   un même compte.
 *
 * Traçabilité impérative ("une histoire d'argent", jamais de suppression) :
 * chaque action crée une nouvelle `HistoriqueEntry` qui s'ajoute à la
 * suite des précédentes, jamais ne les remplace — voir `DemandeHistorique`
 * pour la vue chronologique complète.
 */
export function ValidationCompleteDGActions({
  demandeId,
  mode: usage,
  attenteResoumission = false,
}: {
  demandeId: string;
  mode: "examen" | "annulation" | "resoumission";
  /** `true` après un rejet DG non encore resoumis par le Responsable
   * Finance : "Approuver" désactivé (revérifié côté serveur), "Rejeter"
   * reste disponible. */
  attenteResoumission?: boolean;
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

  function handleResoumettre() {
    if (motif.trim().length < 10) {
      setMotifError("Le motif est obligatoire (10 caractères minimum).");
      return;
    }
    setMotifError(undefined);
    startTransition(async () => {
      const result = await resoumettreValidationCompleteDGAction(demandeId, motif);
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
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" loading={isPending} disabled={attenteResoumission} onClick={handleApprouver}>
          Approuver la validation complète
        </Button>
        {attenteResoumission ? (
          <p className="w-full text-xs text-muted-foreground">
            En attente de resoumission par le Responsable Finance avant nouvelle décision du DG.
          </p>
        ) : null}
        <Button type="button" variant="danger" disabled={isPending} onClick={() => setMode("rejeter")}>
          Rejeter
        </Button>
      </div>
    );
  }

  if (usage === "resoumission") {
    if (mode === "resoumettre") {
      return (
        <div className="animate-fade-in-up w-full space-y-3 sm:w-auto">
          <Textarea
            label="Motif de la resoumission"
            required
            rows={3}
            placeholder="Ce qui a été corrigé depuis le rejet du DG..."
            value={motif}
            onChange={(e) => {
              setMotif(e.target.value);
              if (motifError) setMotifError(undefined);
            }}
            error={motifError}
          />
          <div className="flex flex-wrap gap-3">
            <Button type="button" loading={isPending} onClick={handleResoumettre}>
              Confirmer la resoumission
            </Button>
            <Button type="button" variant="secondary" disabled={isPending} onClick={resetMotif}>
              Annuler
            </Button>
          </div>
        </div>
      );
    }

    return (
      <Button type="button" onClick={() => setMode("resoumettre")}>
        Resoumettre au DG
      </Button>
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

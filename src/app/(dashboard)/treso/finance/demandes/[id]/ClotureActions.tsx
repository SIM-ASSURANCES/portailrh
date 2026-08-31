"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Textarea } from "@/components/ui";

import { cloturerDemandeAction } from "./actions";

type Mode = "idle" | "totale" | "partielle";

/**
 * Boutons "Clôturer totalement" / "Clôturer partiellement" d'une demande
 * VALIDEE. Réservés (au niveau de la page appelante) à
 * `treso.cloturer_demande` — même principe que `ValidationActions.tsx`
 * (Ticket 3) : ne jamais supposer cette permission acquise ailleurs dans
 * l'espace Finance partagé.
 *
 * Clôture totale : motif libre optionnel (simple commentaire de clôture).
 * Clôture partielle : motif obligatoire (min 3 caractères), refusé côté
 * serveur sans lui — revérifié dans `cloturerDemandeAction`, jamais
 * uniquement via ce contrôle client.
 */
export function ClotureActions({ demandeId }: { demandeId: string }) {
  const [mode, setMode] = useState<Mode>("idle");
  const [motif, setMotif] = useState("");
  const [motifError, setMotifError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  function handleCloturer(type: "TOTALE" | "PARTIELLE") {
    if (type === "PARTIELLE" && motif.trim().length < 3) {
      setMotifError("Le motif de la clôture partielle est obligatoire (3 caractères minimum).");
      return;
    }
    setMotifError(undefined);
    startTransition(async () => {
      const result = await cloturerDemandeAction(demandeId, type, motif || undefined);
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
      <h2 className="text-sm font-semibold text-foreground">Clôture</h2>

      {mode === "idle" ? (
        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={() => setMode("totale")}>
            Clôturer totalement
          </Button>
          <Button type="button" variant="secondary" onClick={() => setMode("partielle")}>
            Clôturer partiellement
          </Button>
        </div>
      ) : null}

      {mode === "totale" ? (
        <div className="animate-fade-in-up space-y-3">
          <p className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning">
            Confirmer la clôture totale ? Cette action est <strong>définitive</strong> : plus aucun
            règlement, retour ou clôture ne sera possible sur cette demande.
          </p>
          <Textarea
            label="Commentaire"
            rows={2}
            hint="Optionnel."
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
          />
          <div className="flex flex-wrap gap-3">
            <Button type="button" loading={isPending} onClick={() => handleCloturer("TOTALE")}>
              Confirmer la clôture totale
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isPending}
              onClick={() => {
                setMode("idle");
                setMotif("");
              }}
            >
              Annuler
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "partielle" ? (
        <div className="animate-fade-in-up space-y-3">
          <p className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning">
            Confirmer la clôture partielle ? Cette action est <strong>définitive</strong> : plus aucun
            règlement, retour ou clôture ne sera possible sur cette demande.
          </p>
          <Textarea
            label="Motif de la clôture partielle"
            required
            rows={3}
            placeholder="Expliquez ce qui reste non justifié..."
            value={motif}
            onChange={(e) => {
              setMotif(e.target.value);
              if (motifError) setMotifError(undefined);
            }}
            error={motifError}
          />
          <div className="flex flex-wrap gap-3">
            <Button type="button" loading={isPending} onClick={() => handleCloturer("PARTIELLE")}>
              Confirmer la clôture partielle
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

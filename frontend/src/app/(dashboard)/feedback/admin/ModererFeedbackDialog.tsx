"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button, Textarea } from "@/components/ui";
import { modererFeedbackAction } from "./actions";

interface ModererFeedbackDialogProps {
  feedbackId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function ModererFeedbackDialog({ feedbackId, onSuccess, onCancel }: ModererFeedbackDialogProps) {
  const [motif, setMotif] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (motif.trim().length < 3) {
      setError("Le motif de modération doit contenir au moins 3 caractères.");
      return;
    }

    startTransition(async () => {
      const res = await modererFeedbackAction(feedbackId, motif);
      if (res.status === "success") {
        toast.success(res.message);
        onSuccess();
      } else {
        setError(res.message);
        toast.error(res.message);
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-foreground">Modérer ce message</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Ce message sera immédiatement retiré de la plateforme (vue publique et vue employé).
          Indiquez le motif obligatoire justifiant cette modération.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <Textarea
            label="Motif de modération *"
            placeholder="Ex : Propos diffamatoires, attaque personnelle non constructive, spam..."
            value={motif}
            onChange={(e) => {
              setMotif(e.target.value);
              if (error) setError(null);
            }}
            rows={3}
            disabled={isPending}
            required
          />
          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onCancel} disabled={isPending}>
              Annuler
            </Button>
            <Button type="submit" variant="danger" disabled={isPending}>
              {isPending ? "Modération en cours..." : "Confirmer le retrait"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

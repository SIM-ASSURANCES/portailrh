"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button, Textarea } from "@/components/ui";
import { modererFeedbackAction, retablirFeedbackAction } from "./actions";

const TEXTES = {
  masquer: {
    titre: "Modérer ce message",
    explication:
      "Ce message sera immédiatement retiré de la vue de son destinataire. Indiquez le motif obligatoire justifiant cette modération.",
    label: "Motif de modération *",
    exemple: "Ex : Propos diffamatoires, attaque personnelle non constructive, spam...",
    tropCourt: "Le motif de modération doit contenir au moins 3 caractères.",
    confirmer: "Confirmer le retrait",
    enCours: "Modération en cours...",
    variante: "danger",
    action: modererFeedbackAction,
  },
  retablir: {
    titre: "Rétablir ce message",
    explication:
      "Ce message redeviendra visible (un avis « Collaboration » réapparaît chez son destinataire). Indiquez le motif obligatoire du rétablissement.",
    label: "Motif du rétablissement *",
    exemple: "Ex : Message masqué par erreur...",
    tropCourt: "Le motif du rétablissement doit contenir au moins 3 caractères.",
    confirmer: "Confirmer le rétablissement",
    enCours: "Rétablissement en cours...",
    variante: "primary",
    action: retablirFeedbackAction,
  },
} as const;

interface ModererFeedbackDialogProps {
  operation: keyof typeof TEXTES;
  feedbackId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function ModererFeedbackDialog({ operation, feedbackId, onSuccess, onCancel }: ModererFeedbackDialogProps) {
  const textes = TEXTES[operation];
  const [motif, setMotif] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (motif.trim().length < 3) {
      setError(textes.tropCourt);
      return;
    }

    startTransition(async () => {
      const res = await textes.action(feedbackId, motif);
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
        <h3 className="text-lg font-semibold text-foreground">{textes.titre}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{textes.explication}</p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <Textarea
            label={textes.label}
            placeholder={textes.exemple}
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
            <Button type="submit" variant={textes.variante} disabled={isPending}>
              {isPending ? textes.enCours : textes.confirmer}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

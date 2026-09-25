"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Input, Textarea } from "@/components/ui";

import { ajusterTotalDeclareRetourAction } from "../retourActions";

/**
 * Ajustement du total déclaré d'un retour sous signalement actif (voir
 * CLAUDE.md "Le Responsable Finance peut ajuster le total déclaré") —
 * affiché uniquement au Responsable Finance (garde revérifiée côté serveur
 * par `ajusterTotalDeclareRetourAction`). Un motif d'au moins 10 caractères
 * est obligatoire ; le plafond de saisie de l'Assistant Finance suit
 * aussitôt le nouveau total.
 */
export function AjusterTotalDeclareForm({ retourId, totalActuel }: { retourId: string; totalActuel: number }) {
  const [open, setOpen] = useState(false);
  const [total, setTotal] = useState(String(totalActuel));
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Ajuster le total déclaré
      </Button>
    );
  }

  function handleSubmit() {
    const nouveau = Number(total);
    if (!nouveau || nouveau <= 0) {
      setErreur("Le nouveau total doit être supérieur à 0.");
      return;
    }
    if (motif.trim().length < 10) {
      setErreur("Le motif est obligatoire (10 caractères minimum).");
      return;
    }
    setErreur(undefined);
    startTransition(async () => {
      const result = await ajusterTotalDeclareRetourAction(retourId, nouveau, motif);
      if (result.status === "success") {
        toast.success(result.message);
        setOpen(false);
        setMotif("");
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="animate-fade-in-up space-y-3 rounded-md border border-border bg-surface p-3 text-foreground">
      <p className="text-xs text-muted-foreground">
        Total déclaré actuel : <span className="font-semibold text-foreground">{totalActuel.toLocaleString("fr-FR")} FCFA</span>.
        L&apos;Assistant Finance pourra ensuite détailler jusqu&apos;au nouveau total.
      </p>
      <Input
        label="Nouveau total déclaré (FCFA)"
        type="number"
        inputMode="decimal"
        min="0"
        step="1"
        required
        value={total}
        onChange={(e) => setTotal(e.target.value)}
      />
      <Textarea
        label="Motif de l'ajustement"
        rows={2}
        required
        hint="10 caractères minimum."
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
      />
      {erreur ? <p className="text-sm text-danger">{erreur}</p> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="button" loading={isPending} onClick={handleSubmit}>
          Enregistrer l&apos;ajustement
        </Button>
        <Button type="button" variant="secondary" disabled={isPending} onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </div>
  );
}

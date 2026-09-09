"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Input, Textarea } from "@/components/ui";

import { definirSoldeOuvertureAction } from "./actions";

/**
 * Formulaire de première définition du solde d'ouverture — n'est rendu par
 * la page appelante que si `!info.existe` (aucun solde jamais défini,
 * jamais un second formulaire par-dessus un solde déjà en vigueur).
 */
export function SoldeOuvertureForm() {
  const [montant, setMontant] = useState("");
  const [montantError, setMontantError] = useState<string | undefined>();
  const [motif, setMotif] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    const valeur = Number(montant);
    if (!valeur || valeur <= 0) {
      setMontantError("Le montant doit être supérieur à 0.");
      return;
    }
    setMontantError(undefined);
    startTransition(async () => {
      const result = await definirSoldeOuvertureAction(valeur, motif.trim() || undefined);
      if (result.status === "success") {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <p className="text-sm text-muted-foreground">
        Aucun solde d&apos;ouverture n&apos;a encore été défini. Renseignez le montant physiquement présent en
        caisse à ce jour — cette opération n&apos;est possible qu&apos;<strong>une seule fois</strong> ; une
        correction ultérieure passera par une écriture tracée distincte.
      </p>
      <Input
        label="Montant (FCFA)"
        type="number"
        inputMode="decimal"
        min="1"
        step="1"
        required
        value={montant}
        onChange={(e) => {
          setMontant(e.target.value);
          if (montantError) setMontantError(undefined);
        }}
        error={montantError}
      />
      <Textarea
        label="Motif / commentaire"
        rows={2}
        hint="Optionnel"
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
      />
      <Button type="button" loading={isPending} onClick={handleSubmit}>
        Définir le solde d&apos;ouverture
      </Button>
    </div>
  );
}

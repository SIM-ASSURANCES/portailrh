"use client";

import { useState } from "react";

import { Button } from "@/components/ui";

import { DeclarerRetourAssistantForm } from "./DeclarerRetourAssistantForm";

/**
 * Déclencheur client "Déclarer les dépenses (aucun retour du
 * collaborateur)" — bascule vers `DeclarerRetourAssistantForm` à la
 * demande, jamais affiché en même temps que le bouton (même convention
 * que `ReglementForm`/`RetourCaisseForm`).
 */
export function RetourAssistantTrigger({
  reglementId,
  montantReglement,
  motifReouvertureRequis,
}: {
  reglementId: string;
  montantReglement: number;
  motifReouvertureRequis: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Aucun retour du collaborateur — déclarer les dépenses
      </Button>
    );
  }

  return (
    <DeclarerRetourAssistantForm
      reglementId={reglementId}
      montantReglement={montantReglement}
      motifReouvertureRequis={motifReouvertureRequis}
      onCancel={() => setOpen(false)}
      onSuccess={() => setOpen(false)}
    />
  );
}

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
  modeReglement,
  raisonIndisponible = null,
}: {
  reglementId: string;
  montantReglement: number;
  motifReouvertureRequis: boolean;
  modeReglement: "CAISSE" | "BANQUE";
  /** Conflit d'intérêts : bouton grisé avec la phrase du serveur. */
  raisonIndisponible?: string | null;
}) {
  const [open, setOpen] = useState(false);

  if (!open || raisonIndisponible) {
    return (
      <div className="space-y-1">
        <Button type="button" variant="secondary" disabled={!!raisonIndisponible} onClick={() => setOpen(true)}>
          Aucun retour du collaborateur — déclarer les dépenses
        </Button>
        {raisonIndisponible ? <p className="text-xs text-muted-foreground">{raisonIndisponible}</p> : null}
      </div>
    );
  }

  return (
    <DeclarerRetourAssistantForm
      reglementId={reglementId}
      montantReglement={montantReglement}
      motifReouvertureRequis={motifReouvertureRequis}
      modeReglement={modeReglement}
      onCancel={() => setOpen(false)}
      onSuccess={() => setOpen(false)}
    />
  );
}

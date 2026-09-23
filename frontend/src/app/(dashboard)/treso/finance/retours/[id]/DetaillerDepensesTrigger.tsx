"use client";

import { useState } from "react";

import { Button } from "@/components/ui";

import type { LigneDetailInput } from "../retourActions";
import { DetaillerDepensesForm } from "./DetaillerDepensesForm";

/**
 * Déclencheur client "Détailler les dépenses" / "Corriger le détail" —
 * bascule vers `DetaillerDepensesForm` à la demande, même convention que
 * `RetourAssistantTrigger`/`ReglementForm`.
 *
 * **`disabled`** — visible mais désactivé pour un compte sans
 * `treso.receptionner_retour` (Responsable Finance en lecture seule),
 * jamais absent, même principe que le reste du module.
 */
export function DetaillerDepensesTrigger({
  retourId,
  montantCible,
  lignesInitiales,
  label,
  disabled = false,
}: {
  retourId: string;
  montantCible: number;
  lignesInitiales: LigneDetailInput[];
  label: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="secondary" disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }

  return (
    <DetaillerDepensesForm
      retourId={retourId}
      montantCible={montantCible}
      lignesInitiales={lignesInitiales}
      onCancel={() => setOpen(false)}
      onSuccess={() => setOpen(false)}
    />
  );
}

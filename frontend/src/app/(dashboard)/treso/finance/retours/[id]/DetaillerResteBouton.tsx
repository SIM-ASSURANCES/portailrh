"use client";

import { useState } from "react";

import { Button } from "@/components/ui";

import { DetaillerDepensesForm } from "./DetaillerDepensesForm";

/** « Détailler » le reste non détaillé (2026-10-10) : ouvre la saisie de nouvelles lignes prises sur ce reste. */
export function DetaillerResteBouton({ retourId, reste }: { retourId: string; reste: number }) {
  const [ouvert, setOuvert] = useState(false);
  if (!ouvert) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOuvert(true)}>
        Détailler
      </Button>
    );
  }
  return (
    <DetaillerDepensesForm
      retourId={retourId}
      ajout
      montantCible={reste}
      lignesInitiales={[]}
      onCancel={() => setOuvert(false)}
      onSuccess={() => setOuvert(false)}
    />
  );
}

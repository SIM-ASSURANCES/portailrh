"use client";

import { useState } from "react";

import { Button } from "@/components/ui";

import { DetaillerDepensesForm } from "../../retours/[id]/DetaillerDepensesForm";

/**
 * Détail des dépenses d'un règlement Caisse SANS retour de caisse préalable (2026-10-10) : l'Assistant Finance le
 * renseigne directement ; le serveur le range dans une fiche de régularisation (`detaillerDepensesReglementAction`).
 * Grisé avec la phrase du serveur pour un compte en conflit d'intérêts (garde 8).
 */
export function DetaillerDepensesReglement({
  reglementId,
  disponible,
  raisonIndisponible = null,
}: {
  reglementId: string;
  /** Montant remis restant à expliquer sur ce règlement. */
  disponible: number;
  raisonIndisponible?: string | null;
}) {
  const [ouvert, setOuvert] = useState(false);
  if (!ouvert || raisonIndisponible) {
    return (
      <div className="space-y-1">
        <Button type="button" variant="secondary" disabled={!!raisonIndisponible || disponible <= 0} onClick={() => setOuvert(true)}>
          Détailler les dépenses
        </Button>
        {raisonIndisponible ? <p className="text-xs text-muted-foreground">{raisonIndisponible}</p> : null}
        {!raisonIndisponible && disponible <= 0 ? (
          <p className="text-xs text-muted-foreground">Rien à détailler : les fonds remis sont déjà expliqués.</p>
        ) : null}
      </div>
    );
  }
  return (
    <DetaillerDepensesForm
      reglementId={reglementId}
      libre
      montantCible={disponible}
      lignesInitiales={[]}
      onCancel={() => setOuvert(false)}
      onSuccess={() => setOuvert(false)}
    />
  );
}

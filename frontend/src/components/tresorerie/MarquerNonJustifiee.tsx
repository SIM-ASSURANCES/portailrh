"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Input } from "@/components/ui";
import { marquerDepenseNonJustifieeAction } from "@/app/(dashboard)/treso/finance/retours/retourActions";

/**
 * Ligne "Marquer non justifiée" pour une `DepenseLigne` précise — voir
 * CLAUDE.md "Motif Finance sur dépense non justifiée". Extrait de
 * `RetoursEnAttenteTable.tsx` (Ticket "Détail des dépenses sur l'écran de
 * Régularisation") pour être réutilisé aussi depuis `RegularisationSummary.tsx`
 * — un seul composant, jamais deux implémentations divergentes de la même
 * action. Affiche le motif déjà enregistré s'il existe (jamais réécrit par
 * cette même UI : seule la réception du retour la verrouille définitivement
 * — revérifié côté serveur de toute façon), sinon un petit formulaire
 * inline ouvert à la demande (même convention que `BudgetAlloueField.tsx` :
 * enregistrement explicite par bouton, jamais à chaque frappe).
 */
export function MarquerNonJustifiee({
  depense,
}: {
  depense: {
    id: string;
    motifNonJustifie: string | null;
    motifNonJustifiePar: string | null;
  };
}) {
  const [ouvert, setOuvert] = useState(false);
  const [motif, setMotif] = useState("");
  const [isPending, startTransition] = useTransition();

  if (depense.motifNonJustifie) {
    return (
      <p className="text-xs text-warning">
        Motif Finance{depense.motifNonJustifiePar ? ` (${depense.motifNonJustifiePar})` : ""} :{" "}
        {depense.motifNonJustifie}
      </p>
    );
  }

  if (!ouvert) {
    return (
      <button
        type="button"
        className="text-xs text-info underline-offset-4 hover:text-primary hover:underline"
        onClick={() => setOuvert(true)}
      >
        Marquer non justifiée
      </button>
    );
  }

  function handleConfirmer() {
    startTransition(async () => {
      const result = await marquerDepenseNonJustifieeAction(depense.id, motif);
      if (result.status === "success") {
        toast.success(result.message);
        setOuvert(false);
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-48">
        <Input
          aria-label="Motif (non justifiée)"
          placeholder="Motif obligatoire"
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
        />
      </div>
      <Button type="button" variant="secondary" loading={isPending} onClick={handleConfirmer}>
        Confirmer
      </Button>
      <Button type="button" variant="secondary" disabled={isPending} onClick={() => setOuvert(false)}>
        Annuler
      </Button>
    </div>
  );
}

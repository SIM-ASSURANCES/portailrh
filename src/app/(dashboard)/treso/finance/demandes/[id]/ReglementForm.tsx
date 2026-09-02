"use client";

import { useActionState, useEffect, useState } from "react";

import { Button, Input, Select } from "@/components/ui";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import { IDLE_ACTION_STATE } from "@/lib/validation";

import { creerReglementAction } from "./reglementActions";

/**
 * Formulaire "Ajouter un règlement" — repliable, n'apparaît que si
 * `treso.effectuer_reglement` ET reste à régler > 0 (vérifié par la page
 * appelante). Le montant maximal (`max`) donne un premier refus côté
 * client via la validation native du navigateur ; l'autorité reste la
 * Server Action, qui revérifie le reste à régler côté serveur.
 */
export function ReglementForm({ demandeId, resteARegler }: { demandeId: string; resteARegler: number }) {
  const [state, formAction, isPending] = useActionState(creerReglementAction, IDLE_ACTION_STATE);
  const [open, setOpen] = useState(false);
  useActionFeedback(state);

  useEffect(() => {
    if (state.status === "success") {
      // Referme le formulaire après une création réussie : réaction à un
      // résultat de Server Action (via useActionState), pas un état dérivé
      // au rendu — même cas que le pattern déjà justifié dans AppShell.tsx.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- réaction ponctuelle à un ActionState de succès, pas un état dérivé du rendu
      setOpen(false);
    }
  }, [state]);

  if (!open) {
    // Couleur primaire (Tâche navigation/UX) : c'est la seule action
    // proposée par cette section tant qu'aucun règlement n'existe encore
    // — mérite la même visibilité que "Confirmer" une fois le formulaire
    // ouvert, pas un gris secondaire pour l'action qui déclenche tout le
    // reste du cycle de règlement.
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        Ajouter un règlement
      </Button>
    );
  }

  return (
    <form action={formAction} className="animate-fade-in-up space-y-4 rounded-md border border-border p-4">
      <input type="hidden" name="demandeId" value={demandeId} />
      <Input
        name="montant"
        label="Montant"
        type="number"
        inputMode="decimal"
        min="1"
        max={resteARegler}
        step="1"
        required
        hint={`Reste à régler : ${resteARegler.toLocaleString("fr-FR")} FCFA`}
        error={state.status === "error" ? state.fieldErrors?.montant : undefined}
      />
      <Select
        name="mode"
        label="Mode de règlement"
        required
        options={[
          { value: "CAISSE", label: "Caisse" },
          { value: "BANQUE", label: "Banque" },
        ]}
        error={state.status === "error" ? state.fieldErrors?.mode : undefined}
      />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={isPending}>
          Créer le règlement
        </Button>
        <Button type="button" variant="secondary" disabled={isPending} onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

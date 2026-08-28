"use client";

import { useActionState, useEffect } from "react";

import { Button, Input, Select, Textarea } from "@/components/ui";
import { JUSTIFICATION_OPTIONS } from "@/components/tresorerie/justification";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import { IDLE_ACTION_STATE } from "@/lib/validation";

import { creerRetourCaisseAction } from "./retourActions";

/**
 * Formulaire de déclaration d'un retour de caisse, associé à un règlement
 * précis (`reglementId`, passé en champ caché — jamais un formulaire libre
 * indépendant, conformément à la règle impérative du cahier des charges).
 *
 * Le commentaire n'est obligatoire côté serveur que si la justification
 * choisie est « Dépense sans pièce formelle » (`.superRefine()` dans
 * `retourActions.ts`) : pas de duplication de cette règle côté client, le
 * hint sous le champ suffit à guider l'utilisateur, le message d'erreur
 * serveur reste la source de vérité affichée si l'utilisateur l'ignore.
 */
export function RetourCaisseForm({
  reglementId,
  onCancel,
  onSuccess,
}: {
  reglementId: string;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [state, formAction, isPending] = useActionState(creerRetourCaisseAction, IDLE_ACTION_STATE);
  useActionFeedback(state);

  useEffect(() => {
    if (state.status === "success") {
      // Referme le formulaire après succès via un état local (callback du
      // parent), jamais en attendant qu'un prop dérivé du Server Component
      // parent change : voir le commentaire de RetourCaisseRow.tsx pour la
      // course observée avec le toast de succès. Même pattern déjà justifié
      // pour ReglementForm.tsx.
      onSuccess();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onSuccess est une closure stable recréée à chaque rendu du parent, pas une dépendance à suivre
  }, [state]);

  return (
    <form action={formAction} className="space-y-4 border-t border-border pt-4">
      <input type="hidden" name="reglementId" value={reglementId} />
      <Input
        name="montantDepense"
        label="Montant dépensé"
        type="number"
        inputMode="decimal"
        min="0"
        step="1"
        required
        error={state.status === "error" ? state.fieldErrors?.montantDepense : undefined}
      />
      <Input
        name="montantARetourner"
        label="Montant à retourner"
        type="number"
        inputMode="decimal"
        min="0"
        step="1"
        required
        error={state.status === "error" ? state.fieldErrors?.montantARetourner : undefined}
      />
      <Select
        name="justification"
        label="Justification"
        placeholder="Sélectionner..."
        required
        options={JUSTIFICATION_OPTIONS}
        error={state.status === "error" ? state.fieldErrors?.justification : undefined}
      />
      <Textarea
        name="commentaire"
        label="Commentaire"
        rows={3}
        hint="Obligatoire si la justification est « Dépense sans pièce formelle »."
        error={state.status === "error" ? state.fieldErrors?.commentaire : undefined}
      />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={isPending}>
          Déclarer le retour
        </Button>
        <Button type="button" variant="secondary" disabled={isPending} onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

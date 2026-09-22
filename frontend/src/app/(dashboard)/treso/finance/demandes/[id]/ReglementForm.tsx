"use client";

import { useActionState, useEffect, useState } from "react";

import { Button, Input, Select } from "@/components/ui";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import { IDLE_ACTION_STATE } from "backend/client";

import { AllocationCategorieFields, type CategorieAllocationOption } from "./AllocationCategorieFields";
import { creerReglementAction } from "./reglementActions";

/**
 * Formulaire "Ajouter un règlement" — repliable, affiché dès que le reste
 * à régler > 0 (vérifié par la page appelante). Le montant maximal (`max`)
 * donne un premier refus côté client via la validation native du
 * navigateur ; l'autorité reste la Server Action, qui revérifie le reste à
 * régler côté serveur.
 *
 * **`disabled`** (Tâche "Séparation Responsable Finance / Assistant
 * Finance") — le bouton d'entrée reste VISIBLE mais désactivé pour un
 * compte sans `treso.effectuer_reglement` (ex: le Responsable Finance),
 * jamais absent : empêche d'ouvrir le formulaire plutôt que de le
 * masquer, même principe que `ValidationActions`.
 *
 * **`categoriesConcernees`** (Tâche "Allocation budgétaire explicite par
 * règlement", voir CLAUDE.md) — si elle contient au moins 2 catégories,
 * affiche `AllocationCategorieFields` en plus du montant/mode habituels ;
 * sinon (0 ou 1 catégorie, le cas le plus fréquent), **aucun changement
 * visible** par rapport à avant cette tâche — l'allocation unique à 100%
 * est créée automatiquement côté serveur.
 */
export function ReglementForm({
  demandeId,
  resteARegler,
  categoriesConcernees,
  disabled = false,
}: {
  demandeId: string;
  resteARegler: number;
  categoriesConcernees: CategorieAllocationOption[];
  disabled?: boolean;
}) {
  const [state, formAction, isPending] = useActionState(creerReglementAction, IDLE_ACTION_STATE);
  const [open, setOpen] = useState(false);
  const [montant, setMontant] = useState("");
  const [allocValues, setAllocValues] = useState<Record<string, string>>({});
  useActionFeedback(state);

  const multiCategories = categoriesConcernees.length >= 2;

  useEffect(() => {
    if (state.status === "success") {
      // Referme le formulaire après une création réussie : réaction à un
      // résultat de Server Action (via useActionState), pas un état dérivé
      // au rendu — même cas que le pattern déjà justifié dans AppShell.tsx.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- réaction ponctuelle à un ActionState de succès, pas un état dérivé du rendu
      setOpen(false);
      setMontant("");
      setAllocValues({});
    }
  }, [state]);

  const sommeAllocations = categoriesConcernees.reduce(
    (total, c) => total + (Number(allocValues[c.categorieId]) || 0),
    0
  );
  const allocationValide =
    !multiCategories || Math.round(sommeAllocations * 100) === Math.round((Number(montant) || 0) * 100);

  if (!open) {
    // Couleur primaire (Tâche navigation/UX) : c'est la seule action
    // proposée par cette section tant qu'aucun règlement n'existe encore
    // — mérite la même visibilité que "Confirmer" une fois le formulaire
    // ouvert, pas un gris secondaire pour l'action qui déclenche tout le
    // reste du cycle de règlement.
    return (
      <div className="space-y-1">
        <Button type="button" disabled={disabled} onClick={() => setOpen(true)}>
          Ajouter un règlement
        </Button>
        {disabled ? (
          <p className="text-xs text-muted-foreground">
            Votre rôle ne permet pas d&apos;effectuer de règlement.
          </p>
        ) : null}
      </div>
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
        value={montant}
        onChange={(e) => setMontant(e.target.value)}
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

      {multiCategories ? (
        <AllocationCategorieFields
          categories={categoriesConcernees}
          montantTotal={Number(montant) || 0}
          values={allocValues}
          onChange={(categorieId, valeur) => setAllocValues((prev) => ({ ...prev, [categorieId]: valeur }))}
        />
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={isPending} disabled={!allocationValide}>
          Créer le règlement
        </Button>
        <Button type="button" variant="secondary" disabled={isPending} onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

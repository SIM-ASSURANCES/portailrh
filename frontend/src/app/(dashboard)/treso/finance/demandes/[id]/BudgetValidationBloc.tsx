"use client";

import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { BudgetPrevision } from "@/components/tresorerie/BudgetPrevision";
import { ChampMotifEchange, motifEchangeValide } from "@/components/tresorerie/ChampMotifEchange";
import { Button } from "@/components/ui";
import { previsionBudget, verdictBudget, type PrevisionBudget, type VerdictBudget } from "backend/client";

import { demanderConfirmationDepassementAction } from "../../budgets/actions";
import type { BudgetValidation } from "./LignesValidationTable";

/**
 * Budget à la validation d'une demande SANS article (dépense directe), lot J : reste du budget global et de la catégorie après
 * le montant que l'on s'apprête à valider, alerte orange, blocage rouge (confirmation du DG, dans le même geste s'il valide).
 * Retourne le bloc à afficher, l'état de blocage et le motif de confirmation à transmettre à l'action de validation.
 */
export function useBudgetValidation({
  budget,
  demandeId,
  categorieId,
  montant,
}: {
  budget: (BudgetValidation & { categorieId: string | null }) | null;
  demandeId: string;
  categorieId: string | null;
  montant: number;
}): { bloc: ReactNode; bloque: boolean; motifDepassement: string | undefined; prevision: PrevisionBudget | null; verdict: VerdictBudget | null } {
  const [motif, setMotif] = useState("");
  // Lot M : motif de la demande de confirmation adressée au DG (10 à 300 caractères).
  const [motifDemande, setMotifDemande] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [, startTransition] = useTransition();

  const prevision = budget && montant > 0 ? previsionBudget(budget.contexte, [{ categorieId, montant }]) : null;
  const verdict =
    budget && prevision ? verdictBudget({ prevision, acteurEstDG: budget.estDG, motifConfirmation: motif, confirmationExistante: budget.confirmationDonnee }) : null;
  const bloque = verdict !== null && !verdict.autorise;

  function demander() {
    setEnCours(true);
    startTransition(async () => {
      const r = await demanderConfirmationDepassementAction(demandeId, [], montant, motifDemande.trim());
      setEnCours(false);
      if (r.status === "success") toast.success(r.message);
      else toast.error(r.message);
    });
  }

  const bloc =
    budget && prevision ? (
      <div className="space-y-2">
        <BudgetPrevision prevision={prevision} />
        {prevision.niveau === "ORANGE" ? (
          <p data-alerte-budget="ORANGE" role="status" className="rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm font-medium text-foreground">
            Alerte orange : cette validation rapproche un budget de son seuil. Vous pouvez valider ; la Finance et le DG sont prévenus.
          </p>
        ) : null}
        {prevision.niveau === "ROUGE" ? (
          <div data-alerte-budget="ROUGE" role="alert" className="space-y-2 rounded-md border border-danger bg-danger-bg px-3 py-2">
            <p className="text-sm font-semibold text-foreground">
              Alerte rouge : cette validation atteint le seuil rouge d&apos;un budget.{" "}
              {budget.estDG
                ? "Confirmez le dépassement ci-dessous (motif obligatoire), tracé dans l'historique."
                : budget.confirmationDonnee
                  ? "Le DG a confirmé le dépassement : vous pouvez valider."
                  : "La validation est bloquée tant que le DG n'a pas confirmé le dépassement."}
            </p>
            {budget.estDG ? (
              <ChampMotifEchange name="motifDepassement" label="Motif de la confirmation du dépassement" value={motif} onChange={setMotif} />
            ) : !budget.confirmationDonnee ? (
              <>
                {!budget.confirmationDemandee ? (
                  <ChampMotifEchange
                    name="motifDemandeDepassement"
                    label="Motif de la demande de confirmation au DG"
                    hint="Transmis au DG."
                    value={motifDemande}
                    onChange={setMotifDemande}
                  />
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  data-demander-confirmation-dg
                  loading={enCours}
                  disabled={budget.confirmationDemandee || !motifEchangeValide(motifDemande)}
                  onClick={demander}
                >
                  {budget.confirmationDemandee ? "Confirmation demandée au DG — en attente" : "Demander la confirmation du DG"}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    ) : null;

  return { bloc, bloque, motifDepassement: budget?.estDG && prevision?.niveau === "ROUGE" ? motif.trim() : undefined, prevision, verdict };
}

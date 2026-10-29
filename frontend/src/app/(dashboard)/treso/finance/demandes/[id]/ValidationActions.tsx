"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ChampMotifEchange, motifEchangeValide } from "@/components/tresorerie/ChampMotifEchange";
import { Button, InputMontant, Textarea } from "@/components/ui";
import { analyserMontant, valeurSaisieMontant } from "backend/client";

import { rejeterDemandeAction, validerPartiellementAction, validerTotalementAction } from "./actions";
import { useBudgetValidation } from "./BudgetValidationBloc";
import type { BudgetValidation } from "./LignesValidationTable";

type Mode = "idle" | "confirm-totale" | "partielle" | "rejeter";

/**
 * Décision Finance/DG sur une demande `EN_ATTENTE_VALIDATION` : Valider
 * totalement, Valider partiellement (montant inférieur au montant
 * demandé), ou Rejeter. Réservés (au niveau de la page appelante) aux
 * utilisateurs ayant `treso.valider_demande`.
 *
 * REFONTE V1 / Phase B (voir CLAUDE.md "Refonte V1 en cours") : remplace
 * l'ancien bouton unique "Valider" (Ticket 3) par ces trois issues. La
 * validation partielle amène la demande en `PARTIELLEMENT_VALIDEE`, avec sa
 * propre UI de "validation complémentaire" (voir
 * `ValidationComplementaireActions`), affichée à la place de ce composant
 * une fois la demande partiellement validée.
 *
 * Après succès, la page se met à jour automatiquement : la Server Action
 * appelle `revalidatePath()`, ce que Next.js répercute sur ce composant
 * sans navigation ni `router.refresh()` explicite.
 *
 * **`disabled`** (Tâche "Séparation Responsable Finance / Assistant
 * Finance") — toujours rendu, y compris pour un compte sans
 * `treso.valider_demande` (ex: Assistant Finance) : les trois boutons
 * restent VISIBLES mais désactivés, jamais absents, pour que la
 * séparation des tâches soit lisible directement sur l'écran plutôt que
 * de disparaître silencieusement — même principe que le verrou de
 * clôture DG. La Server Action revérifie de toute façon la permission
 * côté serveur, ce masquage n'est qu'une question de clarté d'interface.
 */
export function ValidationActions({
  demandeId,
  montantDemande,
  disabled = false,
  raisonIndisponible = null,
  raisonValidationIndisponible = null,
  budget = null,
  parDG = false,
}: {
  /** Lot M : le DG qui décide (dépense directe de la Finance, ou pour elle-même) joint un motif obligatoire (10 à 300 caractères). */
  parDG?: boolean;
  demandeId: string;
  montantDemande: number;
  /** Lot J : budgets en vigueur et catégorie de la dépense directe ; `null` = aucun budget à afficher. */
  budget?: (BudgetValidation & { categorieId: string | null }) | null;
  disabled?: boolean;
  /** Catégorisation obligatoire : la demande n'a pas de catégorie — seuls les boutons de VALIDATION sont grisés,
   *  « Rejeter » reste possible. */
  raisonValidationIndisponible?: string | null;
  /** Circuit de validation : pourquoi les boutons sont grisés à cette étape (phrase du moteur). */
  raisonIndisponible?: string | null;
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [montantPartiel, setMontantPartiel] = useState("");
  const [montantError, setMontantError] = useState<string | undefined>();
  const [motif, setMotif] = useState("");
  const [motifError, setMotifError] = useState<string | undefined>();
  const [motifDG, setMotifDG] = useState("");
  const motifDGOk = !parDG || motifEchangeValide(motifDG);
  const [isPending, startTransition] = useTransition();
  // Lot J : reste des budgets après le montant que l'on s'apprête à valider (total ou partiel).
  const montantEnCours = mode === "confirm-totale" ? montantDemande : mode === "partielle" ? valeurSaisieMontant(montantPartiel) : 0;
  const budgetValidation = useBudgetValidation({ budget, demandeId, categorieId: budget?.categorieId ?? null, montant: montantEnCours });

  function handleValiderTotalement() {
    startTransition(async () => {
      const result = await validerTotalementAction(demandeId, budgetValidation.motifDepassement, parDG ? motifDG.trim() : undefined);
      if (result.status === "success") {
        toast.success(result.message);
        setMode("idle");
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleValiderPartiellement() {
    const analyse = analyserMontant(montantPartiel);
    if (!analyse.ok || analyse.centimes <= 0) {
      setMontantError(analyse.ok ? "Le montant doit être supérieur à 0." : analyse.message);
      return;
    }
    const montant = analyse.valeur;
    if (montant >= montantDemande) {
      setMontantError(
        `Le montant doit être inférieur au montant demandé (${montantDemande.toLocaleString("fr-FR")} FCFA) — utilisez "Valider totalement" sinon.`
      );
      return;
    }
    setMontantError(undefined);
    startTransition(async () => {
      const result = await validerPartiellementAction(demandeId, montantPartiel, budgetValidation.motifDepassement, parDG ? motifDG.trim() : undefined);
      if (result.status === "success") {
        toast.success(result.message);
        setMode("idle");
        setMontantPartiel("");
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleRejeter() {
    const refus = parDG ? (motifEchangeValide(motif) ? null : "Le motif du rejet est obligatoire (10 à 300 caractères).") : motif.trim().length < 3 || motif.trim().length > 300 ? "Le motif du rejet est obligatoire (3 à 300 caractères)." : null;
    if (refus) {
      setMotifError(refus);
      return;
    }
    setMotifError(undefined);
    startTransition(async () => {
      const result = await rejeterDemandeAction(demandeId, motif.trim());
      if (result.status === "success") {
        toast.success(result.message);
        setMode("idle");
        setMotif("");
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold text-foreground">Décision</h2>

      {mode === "idle" ? (
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            disabled={disabled || !!raisonValidationIndisponible}
            onClick={() => setMode("confirm-totale")}
          >
            Valider totalement
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={disabled || !!raisonValidationIndisponible}
            onClick={() => setMode("partielle")}
          >
            Valider partiellement
          </Button>
          <Button type="button" variant="danger" disabled={disabled} onClick={() => setMode("rejeter")}>
            Rejeter
          </Button>
        </div>
      ) : null}
      {disabled ? (
        <p className="text-xs text-muted-foreground">
          {raisonIndisponible ?? "Votre rôle ne permet pas de valider ou rejeter une demande."}
        </p>
      ) : null}
      {!disabled && raisonValidationIndisponible ? (
        <p data-sans-categorie className="text-xs text-muted-foreground">
          {raisonValidationIndisponible}
        </p>
      ) : null}

      {mode === "confirm-totale" ? (
        <div className="animate-fade-in-up space-y-3">
          <p className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning">
            Confirmer la validation totale ({montantDemande.toLocaleString("fr-FR")} FCFA) ? Le montant
            validé ne pourra plus être réduit ensuite, par personne.
          </p>
          {budgetValidation.bloc}
          {parDG ? <ChampMotifEchange name="motifDG" label="Motif de la décision du DG" hint="Transmis à la Finance." value={motifDG} onChange={setMotifDG} disabled={isPending} /> : null}
          <div className="flex flex-wrap gap-3">
            <Button signe type="button" loading={isPending} disabled={budgetValidation.bloque || !motifDGOk} onClick={handleValiderTotalement}>
              Confirmer la validation totale
            </Button>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => setMode("idle")}>
              Annuler
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "partielle" ? (
        <div className="animate-fade-in-up space-y-3">
          <InputMontant
            label="Montant validé"
            required
            hint={`Montant demandé : ${montantDemande.toLocaleString("fr-FR")} FCFA`}
            value={montantPartiel}
            onValueChange={(texte) => {
              setMontantPartiel(texte);
              if (montantError) setMontantError(undefined);
            }}
            error={montantError}
          />
          <p className="text-xs text-muted-foreground">
            Le reliquat pourra être validé plus tard par une validation complémentaire.
          </p>
          {budgetValidation.bloc}
          {parDG ? <ChampMotifEchange name="motifDG" label="Motif de la décision du DG" hint="Transmis à la Finance." value={motifDG} onChange={setMotifDG} disabled={isPending} /> : null}
          <div className="flex flex-wrap gap-3">
            <Button signe type="button" loading={isPending} disabled={budgetValidation.bloque || !motifDGOk} onClick={handleValiderPartiellement}>
              Confirmer la validation partielle
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isPending}
              onClick={() => {
                setMode("idle");
                setMontantPartiel("");
                setMontantError(undefined);
              }}
            >
              Annuler
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "rejeter" ? (
        <div className="animate-fade-in-up space-y-3">
          {parDG ? (
            <ChampMotifEchange label="Motif du rejet" hint="Transmis à la Finance." rows={3} value={motif} onChange={(m) => { setMotif(m); if (motifError) setMotifError(undefined); }} disabled={isPending} />
          ) : (
            <Textarea
              label="Motif du rejet"
              required
              rows={3}
              maxLength={300}
              placeholder="Expliquez pourquoi cette demande est rejetée..."
              value={motif}
              onChange={(e) => {
                setMotif(e.target.value);
                if (motifError) setMotifError(undefined);
              }}
              error={motifError}
            />
          )}
          <div className="flex flex-wrap gap-3">
            <Button signe type="button" variant="danger" loading={isPending} onClick={handleRejeter}>
              Confirmer le rejet
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isPending}
              onClick={() => {
                setMode("idle");
                setMotif("");
                setMotifError(undefined);
              }}
            >
              Annuler
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

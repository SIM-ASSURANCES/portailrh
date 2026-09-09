"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button, Input, Textarea } from "@/components/ui";

import { corrigerSoldeOuvertureAction } from "./actions";

/**
 * Affichage du solde d'ouverture déjà défini + action de correction, à
 * deux temps ("Corriger le solde d'ouverture" révèle le formulaire, jamais
 * un clic accidentel) — même principe que `ClotureActions.tsx`/
 * `UserDeleteButton.tsx`. La correction ne réécrit jamais l'écriture
 * existante (voir `corrigerSoldeOuvertureAction`) : une nouvelle écriture
 * compensatoire + une nouvelle écriture corrigée, motif obligatoire.
 */
export function SoldeOuvertureCorrection({
  montantActuel,
  definiLe,
}: {
  montantActuel: number;
  /** Date ISO de la première définition (jamais celle d'une correction ultérieure). */
  definiLe: string;
}) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [nouveauMontant, setNouveauMontant] = useState("");
  const [montantError, setMontantError] = useState<string | undefined>();
  const [motif, setMotif] = useState("");
  const [motifError, setMotifError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  function handleCorriger() {
    const valeur = Number(nouveauMontant);
    if (!valeur || valeur <= 0) {
      setMontantError("Le montant doit être supérieur à 0.");
      return;
    }
    if (motif.trim().length < 3) {
      setMotifError("Le motif est obligatoire (3 caractères minimum).");
      return;
    }
    setMontantError(undefined);
    setMotifError(undefined);
    startTransition(async () => {
      const result = await corrigerSoldeOuvertureAction(valeur, motif.trim());
      if (result.status === "success") {
        toast.success(result.message);
        setOuvert(false);
        setNouveauMontant("");
        setMotif("");
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Solde d&apos;ouverture actuel
        </p>
        <p className="mt-1 text-2xl font-black tabular-nums text-foreground">
          {montantActuel.toLocaleString("fr-FR")} <span className="text-base font-bold text-muted-foreground">FCFA</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Défini le {new Date(definiLe).toLocaleDateString("fr-FR")}
        </p>
      </div>

      {!ouvert ? (
        <Button type="button" variant="secondary" onClick={() => setOuvert(true)}>
          Corriger le solde d&apos;ouverture
        </Button>
      ) : (
        <div className="animate-fade-in-up space-y-3 border-t border-border pt-4">
          <p className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning">
            L&apos;écriture d&apos;origine n&apos;est jamais modifiée : cette correction crée une nouvelle écriture
            tracée (annulation du montant actuel + nouveau montant), motif obligatoire.
          </p>
          <Input
            label="Nouveau montant (FCFA)"
            type="number"
            inputMode="decimal"
            min="1"
            step="1"
            required
            value={nouveauMontant}
            onChange={(e) => {
              setNouveauMontant(e.target.value);
              if (montantError) setMontantError(undefined);
            }}
            error={montantError}
          />
          <Textarea
            label="Motif de la correction"
            required
            rows={2}
            placeholder="Ex : montant initial mal saisi, devait être..."
            value={motif}
            onChange={(e) => {
              setMotif(e.target.value);
              if (motifError) setMotifError(undefined);
            }}
            error={motifError}
          />
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="danger" loading={isPending} onClick={handleCorriger}>
              Confirmer la correction
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isPending}
              onClick={() => {
                setOuvert(false);
                setNouveauMontant("");
                setMotif("");
                setMontantError(undefined);
                setMotifError(undefined);
              }}
            >
              Annuler
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

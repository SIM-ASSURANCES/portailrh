"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button, Input, Textarea } from "@/components/ui";
import { PieceJointeUpload } from "@/components/tresorerie/PieceJointeUpload";

import { alimenterCaisseAction, corrigerSoldeOuvertureAction } from "./actions";

/**
 * Affichage du solde d'ouverture déjà défini + action de correction, à
 * deux temps ("Corriger le solde d'ouverture" révèle le formulaire, jamais
 * un clic accidentel) — même principe que `ClotureActions.tsx`/
 * `UserDeleteButton.tsx`. La correction ne réécrit jamais l'écriture
 * existante (voir `corrigerSoldeOuvertureAction`) : une nouvelle écriture
 * compensatoire + une nouvelle écriture corrigée, motif ET pièce jointe
 * obligatoires (voir CLAUDE.md "Pièce jointe obligatoire sur le solde
 * d'ouverture").
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
  const [pieceJointeUrl, setPieceJointeUrl] = useState<string | null>(null);
  const [pieceJointeError, setPieceJointeError] = useState<string | undefined>();
  const [motif, setMotif] = useState("");
  const [motifError, setMotifError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  const [ouvertAlimentation, setOuvertAlimentation] = useState(false);
  const [montantAlimentation, setMontantAlimentation] = useState("");
  const [montantAlimentationError, setMontantAlimentationError] = useState<string | undefined>();
  const [dateAlimentation, setDateAlimentation] = useState(() => new Date().toISOString().slice(0, 10));
  const [pieceJointeAlimentation, setPieceJointeAlimentation] = useState<string | null>(null);
  const [pieceJointeAlimentationError, setPieceJointeAlimentationError] = useState<string | undefined>();
  const [motifAlimentation, setMotifAlimentation] = useState("");
  const [isPendingAlimentation, startTransitionAlimentation] = useTransition();

  function resetFormulaire() {
    setOuvert(false);
    setNouveauMontant("");
    setPieceJointeUrl(null);
    setMotif("");
    setMontantError(undefined);
    setPieceJointeError(undefined);
    setMotifError(undefined);
  }

  function resetFormulaireAlimentation() {
    setOuvertAlimentation(false);
    setMontantAlimentation("");
    setDateAlimentation(new Date().toISOString().slice(0, 10));
    setPieceJointeAlimentation(null);
    setMotifAlimentation("");
    setMontantAlimentationError(undefined);
    setPieceJointeAlimentationError(undefined);
  }

  function handleAlimenter() {
    const valeur = Number(montantAlimentation);
    let bloque = false;
    if (!valeur || valeur <= 0) {
      setMontantAlimentationError("Le montant doit être supérieur à 0.");
      bloque = true;
    }
    if (!pieceJointeAlimentation) {
      setPieceJointeAlimentationError("Une pièce jointe justificative est obligatoire pour cette alimentation.");
      bloque = true;
    }
    if (bloque) return;
    setMontantAlimentationError(undefined);
    setPieceJointeAlimentationError(undefined);
    startTransitionAlimentation(async () => {
      const result = await alimenterCaisseAction(
        valeur,
        dateAlimentation,
        pieceJointeAlimentation!,
        motifAlimentation.trim() || undefined
      );
      if (result.status === "success") {
        toast.success(result.message);
        resetFormulaireAlimentation();
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleCorriger() {
    const valeur = Number(nouveauMontant);
    let bloque = false;
    if (!valeur || valeur <= 0) {
      setMontantError("Le montant doit être supérieur à 0.");
      bloque = true;
    }
    if (!pieceJointeUrl) {
      setPieceJointeError("Une pièce jointe justificative est obligatoire pour cette correction.");
      bloque = true;
    }
    if (motif.trim().length < 3) {
      setMotifError("Le motif est obligatoire (3 caractères minimum).");
      bloque = true;
    }
    if (bloque) return;
    setMontantError(undefined);
    setPieceJointeError(undefined);
    setMotifError(undefined);
    startTransition(async () => {
      const result = await corrigerSoldeOuvertureAction(valeur, pieceJointeUrl!, motif.trim());
      if (result.status === "success") {
        toast.success(result.message);
        resetFormulaire();
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

      {!ouvert && !ouvertAlimentation ? (
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="secondary" onClick={() => setOuvert(true)}>
            Corriger le solde d&apos;ouverture
          </Button>
          <Button type="button" variant="secondary" onClick={() => setOuvertAlimentation(true)}>
            Nouvelle alimentation de caisse
          </Button>
        </div>
      ) : null}

      {ouvertAlimentation ? (
        <div className="animate-fade-in-up space-y-3 border-t border-border pt-4">
          <p className="rounded-md bg-info-bg px-3 py-2 text-sm text-info">
            Apport d&apos;argent physique en caisse en cours d&apos;exploitation — distinct du solde d&apos;ouverture,
            répétable autant de fois que nécessaire. Pièce jointe obligatoire.
          </p>
          <Input
            label="Montant (FCFA)"
            type="number"
            inputMode="decimal"
            min="1"
            step="1"
            required
            value={montantAlimentation}
            onChange={(e) => {
              setMontantAlimentation(e.target.value);
              if (montantAlimentationError) setMontantAlimentationError(undefined);
            }}
            error={montantAlimentationError}
          />
          <Input
            label="Date de l'alimentation"
            type="date"
            required
            hint="La date réelle où l'argent a été remis en caisse, si différente d'aujourd'hui."
            value={dateAlimentation}
            onChange={(e) => setDateAlimentation(e.target.value)}
          />
          <PieceJointeUpload
            label="Pièce justificative (obligatoire)"
            hint="PDF, JPG ou PNG — 10 Mo maximum. Ex : bordereau de remise, reçu de dépôt."
            onChange={(url) => {
              setPieceJointeAlimentation(url);
              if (url && pieceJointeAlimentationError) setPieceJointeAlimentationError(undefined);
            }}
            error={pieceJointeAlimentationError}
          />
          <Textarea
            label="Motif / commentaire"
            rows={2}
            hint="Optionnel"
            value={motifAlimentation}
            onChange={(e) => setMotifAlimentation(e.target.value)}
          />
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              loading={isPendingAlimentation}
              disabled={!pieceJointeAlimentation}
              onClick={handleAlimenter}
            >
              Confirmer l&apos;alimentation
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isPendingAlimentation}
              onClick={resetFormulaireAlimentation}
            >
              Annuler
            </Button>
          </div>
        </div>
      ) : null}

      {ouvert ? (
        <div className="animate-fade-in-up space-y-3 border-t border-border pt-4">
          <p className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning">
            L&apos;écriture d&apos;origine n&apos;est jamais modifiée : cette correction crée une nouvelle écriture
            tracée (annulation du montant actuel + nouveau montant), pièce jointe et motif obligatoires.
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
          <PieceJointeUpload
            label="Pièce justificative (obligatoire)"
            hint="PDF, JPG ou PNG — 10 Mo maximum. Justifie le nouveau montant."
            onChange={(url) => {
              setPieceJointeUrl(url);
              if (url && pieceJointeError) setPieceJointeError(undefined);
            }}
            error={pieceJointeError}
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
            <Button
              type="button"
              variant="danger"
              loading={isPending}
              disabled={!pieceJointeUrl}
              onClick={handleCorriger}
            >
              Confirmer la correction
            </Button>
            <Button type="button" variant="secondary" disabled={isPending} onClick={resetFormulaire}>
              Annuler
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

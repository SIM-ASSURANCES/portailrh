"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Input, Textarea } from "@/components/ui";

import { rejeterReliquatAction, validerComplementaireAction } from "./actions";

type Mode = "idle" | "complementaire" | "rejeter";

/**
 * Actions sur le reliquat non encore validé d'une demande
 * `PARTIELLEMENT_VALIDEE` (Phase B — voir CLAUDE.md "Refonte V1 en cours") :
 * "Validation complémentaire" (existant) et "Rejeter le reliquat" (nouveau —
 * voir CLAUDE.md "Rejet du reliquat"). Les deux peuvent être exécutées par
 * n'importe quel utilisateur habilité (`treso.valider_demande`), pas
 * nécessairement l'auteur de la validation initiale.
 *
 * `montantRestant` plafonne la saisie côté client (confort) ; le serveur
 * revérifie de toute façon qu'elle ne dépasse jamais ce reliquat.
 *
 * N'est rendu par la page appelante que si `!demande.reliquatRejete` — une
 * fois rejeté, ce composant disparaît entièrement, remplacé par un bandeau
 * "Reliquat rejeté : [motif]" (jamais les deux affichés à la fois).
 */
export function ValidationComplementaireActions({
  demandeId,
  montantRestant,
}: {
  demandeId: string;
  montantRestant: number;
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [montant, setMontant] = useState("");
  const [montantError, setMontantError] = useState<string | undefined>();
  const [motif, setMotif] = useState("");
  const [motifError, setMotifError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  function handleValider() {
    const valeur = Number(montant);
    if (!valeur || valeur <= 0) {
      setMontantError("Le montant doit être supérieur à 0.");
      return;
    }
    if (valeur > montantRestant) {
      setMontantError(`Le montant ne peut pas dépasser le reliquat (${montantRestant.toLocaleString("fr-FR")} FCFA).`);
      return;
    }
    setMontantError(undefined);
    startTransition(async () => {
      const result = await validerComplementaireAction(demandeId, valeur);
      if (result.status === "success") {
        toast.success(result.message);
        setMode("idle");
        setMontant("");
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleRejeter() {
    if (motif.trim().length < 3) {
      setMotifError("Le motif est obligatoire (3 caractères minimum).");
      return;
    }
    setMotifError(undefined);
    startTransition(async () => {
      const result = await rejeterReliquatAction(demandeId, motif);
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
      <h2 className="text-sm font-semibold text-foreground">Validation complémentaire</h2>

      {mode === "idle" ? (
        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={() => setMode("complementaire")}>
            Validation complémentaire
          </Button>
          <Button type="button" variant="danger" onClick={() => setMode("rejeter")}>
            Rejeter le reliquat
          </Button>
        </div>
      ) : null}

      {mode === "complementaire" ? (
        <div className="animate-fade-in-up space-y-3">
          <Input
            label="Montant validé à cette étape"
            type="number"
            required
            hint={`Reliquat à valider : ${montantRestant.toLocaleString("fr-FR")} FCFA`}
            value={montant}
            onChange={(e) => {
              setMontant(e.target.value);
              if (montantError) setMontantError(undefined);
            }}
            error={montantError}
          />
          <div className="flex flex-wrap gap-3">
            <Button type="button" loading={isPending} onClick={handleValider}>
              Confirmer la validation complémentaire
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isPending}
              onClick={() => {
                setMode("idle");
                setMontant("");
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
          <p className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning">
            Le montant déjà validé n&apos;est pas affecté : il reste acquis et suit son cours normal (règlement,
            clôture). Seul le reliquat non validé ({montantRestant.toLocaleString("fr-FR")} FCFA) sera
            définitivement clos, sans possibilité de validation complémentaire ultérieure.
          </p>
          <Textarea
            label="Motif du rejet du reliquat"
            required
            rows={3}
            placeholder="Expliquez pourquoi le reliquat ne sera pas validé..."
            value={motif}
            onChange={(e) => {
              setMotif(e.target.value);
              if (motifError) setMotifError(undefined);
            }}
            error={motifError}
          />
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="danger" loading={isPending} onClick={handleRejeter}>
              Confirmer le rejet du reliquat
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

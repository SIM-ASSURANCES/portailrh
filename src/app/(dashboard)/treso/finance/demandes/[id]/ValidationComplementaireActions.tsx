"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Input } from "@/components/ui";

import { validerComplementaireAction } from "./actions";

/**
 * Validation complémentaire sur le reliquat d'une demande
 * `PARTIELLEMENT_VALIDEE` (Phase B — voir CLAUDE.md "Refonte V1 en cours").
 * Peut être exécutée par n'importe quel utilisateur habilité
 * (`treso.valider_demande`), pas nécessairement l'auteur de la validation
 * initiale — aucune restriction d'auteur ici ni côté serveur.
 *
 * `montantRestant` plafonne la saisie côté client (confort) ; le serveur
 * revérifie de toute façon qu'elle ne dépasse jamais ce reliquat (règle
 * impérative : le montant validé cumulé ne peut jamais dépasser le montant
 * demandé).
 */
export function ValidationComplementaireActions({
  demandeId,
  montantRestant,
}: {
  demandeId: string;
  montantRestant: number;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [montant, setMontant] = useState("");
  const [montantError, setMontantError] = useState<string | undefined>();
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
        setOuvert(false);
        setMontant("");
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold text-foreground">Validation complémentaire</h2>

      {!ouvert ? (
        <Button type="button" onClick={() => setOuvert(true)}>
          Validation complémentaire
        </Button>
      ) : (
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
                setOuvert(false);
                setMontant("");
                setMontantError(undefined);
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

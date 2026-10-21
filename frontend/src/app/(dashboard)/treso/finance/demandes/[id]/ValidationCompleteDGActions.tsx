"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ChampMotifEchange, motifEchangeValide } from "@/components/tresorerie/ChampMotifEchange";
import { Button } from "@/components/ui";

import {
  annulerValidationCompleteAction,
  approuverValidationCompleteAction,
  rejeterValidationCompleteAction,
  resoumettreValidationCompleteDGAction,
} from "./actions";

/**
 * Actions du verrou de clôture (Ticket 7 / "Validation complète DG"),
 * réservées (au niveau de la page appelante) à
 * `treso.approuver_validation_complete` (DG uniquement selon le seed).
 *
 * Deux usages distincts selon l'état de la demande, sélectionnés par
 * `mode` :
 * - `"examen"` (`validationCompleteParDG = false`) : "Approuver la
 *   validation complète" (direct) ou "Rejeter" (motif obligatoire — trace
 *   purement informative, ne modifie AUCUN champ de la demande, voir
 *   `rejeterValidationCompleteAction`).
 * - `"annulation"` (`validationCompleteParDG = true`) : "Annuler cette
 *   approbation" (motif obligatoire — remet la demande en attente, voir
 *   `annulerValidationCompleteAction`). N'est rendu par la page appelante
 *   que si la demande n'est pas `CLOTUREE` (sinon un message explicatif la
 *   remplace, jamais un bouton voué à échouer côté serveur).
 * - `"resoumission"` (Tâche "Resoumission au DG après rejet", voir
 *   CLAUDE.md) : "Resoumettre au DG" (motif obligatoire, 10 caractères
 *   minimum — voir `resoumettreValidationCompleteDGAction`). Rendu par la
 *   page appelante sous une garde de permission DISTINCTE et opposée à
 *   celle des deux modes ci-dessus (Responsable Finance UNIQUEMENT, jamais
 *   le DG) — les deux gardes ne s'affichent donc jamais en même temps pour
 *   un même compte.
 *
 * **Lot M — motif obligatoire dans les deux sens** : le champ « Motif » (10 à 300 caractères) est TOUJOURS visible à côté des
 * boutons ; « Approuver » comme « Rejeter » (DG), « Annuler cette approbation » (DG) et « Resoumettre au DG » (Finance) restent
 * grisés tant qu'il n'est pas valable. Le serveur revérifie.
 *
 * Traçabilité impérative ("une histoire d'argent", jamais de suppression) :
 * chaque action crée une nouvelle `HistoriqueEntry` qui s'ajoute à la
 * suite des précédentes, jamais ne les remplace — voir `DemandeHistorique`
 * pour la vue chronologique complète.
 */
export function ValidationCompleteDGActions({
  demandeId,
  mode: usage,
  attenteResoumission = false,
}: {
  demandeId: string;
  mode: "examen" | "annulation" | "resoumission";
  /** `true` après un rejet DG non encore resoumis par le Responsable
   * Finance : "Approuver" désactivé (revérifié côté serveur), "Rejeter"
   * reste disponible. */
  attenteResoumission?: boolean;
}) {
  const [motif, setMotif] = useState("");
  const [isPending, startTransition] = useTransition();
  const motifOk = motifEchangeValide(motif);

  function lancer(action: (demandeId: string, motif: string) => Promise<{ status: string; message?: string }>) {
    startTransition(async () => {
      const result = await action(demandeId, motif.trim());
      if (result.status === "success") {
        toast.success(result.message);
        setMotif("");
      } else {
        toast.error(result.message);
      }
    });
  }

  if (usage === "examen") {
    return (
      <div className="w-full space-y-3 sm:w-auto sm:min-w-80">
        <ChampMotifEchange
          label="Motif de la décision du DG"
          hint="Transmis à la Finance."
          value={motif}
          onChange={setMotif}
          disabled={isPending}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            signe
            type="button"
            loading={isPending}
            disabled={attenteResoumission || !motifOk}
            onClick={() => lancer(approuverValidationCompleteAction)}
          >
            Approuver la validation complète
          </Button>
          <Button
            signe
            type="button"
            variant="danger"
            disabled={isPending || !motifOk}
            onClick={() => lancer(rejeterValidationCompleteAction)}
          >
            Rejeter
          </Button>
          {attenteResoumission ? (
            <p className="w-full text-xs text-muted-foreground">
              En attente de resoumission par Finance avant nouvelle décision du DG.
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (usage === "resoumission") {
    return (
      <div className="w-full space-y-3 sm:w-auto sm:min-w-80">
        <ChampMotifEchange
          label="Motif de la resoumission"
          hint="Ce qui a été corrigé depuis le rejet du DG."
          value={motif}
          onChange={setMotif}
          disabled={isPending}
        />
        <Button signe type="button" loading={isPending} disabled={!motifOk} onClick={() => lancer(resoumettreValidationCompleteDGAction)}>
          Resoumettre au DG
        </Button>
      </div>
    );
  }

  // usage === "annulation"
  return (
    <div className="w-full space-y-3 sm:w-auto sm:min-w-80">
      <ChampMotifEchange
        label="Motif de l'annulation"
        hint="Pourquoi cette approbation est-elle annulée ?"
        value={motif}
        onChange={setMotif}
        disabled={isPending}
      />
      <Button signe type="button" variant="danger" loading={isPending} disabled={!motifOk} onClick={() => lancer(annulerValidationCompleteAction)}>
        Annuler cette approbation
      </Button>
    </div>
  );
}

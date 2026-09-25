"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Input, Textarea } from "@/components/ui";

import { signalerErreurRetourAction } from "./retourActions";

/**
 * Bouton "Signaler une erreur" sur un retour de caisse détaillé par
 * l'Assistant Finance — voir CLAUDE.md "Signalement d'erreur par le
 * Collaborateur". Ouvre un commentaire OBLIGATOIRE (10 caractères minimum)
 * expliquant le problème constaté ; jamais un simple clic sans explication.
 *
 * **`signalementActifCommentaire`** — si un signalement est déjà en cours
 * pour ce retour (non résolu), affiche ce commentaire en lecture seule au
 * lieu du bouton : jamais deux signalements actifs simultanés sur le même
 * retour (déjà refusé côté serveur de toute façon, mais autant ne pas
 * proposer une action vouée à échouer).
 */
export function SignalerErreurRetour({
  retourId,
  signalementActifCommentaire,
}: {
  retourId: string;
  signalementActifCommentaire: string | null;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [commentaire, setCommentaire] = useState("");
  const [montantPropose, setMontantPropose] = useState("");
  const [isPending, startTransition] = useTransition();

  if (signalementActifCommentaire) {
    return (
      <p className="text-xs text-warning">
        Signalement en cours de traitement par l&apos;équipe Finance : {signalementActifCommentaire}
      </p>
    );
  }

  if (!ouvert) {
    return (
      <button
        type="button"
        className="text-xs text-info underline-offset-4 hover:text-primary hover:underline"
        onClick={() => setOuvert(true)}
      >
        Signaler une erreur
      </button>
    );
  }

  function handleEnvoyer() {
    startTransition(async () => {
      const result = await signalerErreurRetourAction(
        retourId,
        commentaire,
        montantPropose.trim() ? Number(montantPropose) : undefined
      );
      if (result.status === "success") {
        toast.success(result.message);
        setOuvert(false);
        setCommentaire("");
        setMontantPropose("");
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-2">
      <Textarea
        label="Expliquer le problème constaté"
        hint="Obligatoire (10 caractères minimum)."
        rows={2}
        value={commentaire}
        onChange={(e) => setCommentaire(e.target.value)}
      />
      <Input
        label="Montant du retour selon vous (FCFA, facultatif)"
        type="number"
        min="0"
        hint="Le montant total que vous auriez dû retourner. Indicatif : l'équipe Finance l'utilise pour proposer la régularisation."
        value={montantPropose}
        onChange={(e) => setMontantPropose(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" loading={isPending} onClick={handleEnvoyer}>
          Envoyer le signalement
        </Button>
        <Button type="button" variant="secondary" disabled={isPending} onClick={() => setOuvert(false)}>
          Annuler
        </Button>
      </div>
    </div>
  );
}

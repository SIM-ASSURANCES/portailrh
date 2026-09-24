"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Input, Textarea } from "@/components/ui";
import { PieceJointeUpload } from "@/components/tresorerie/PieceJointeUpload";

import { declarerRetourAssistantAction } from "../../retours/retourActions";

/**
 * Formulaire permettant à l'Assistant Finance de déclarer l'EXISTENCE d'un
 * retour de caisse en l'absence de dépôt du collaborateur — voir CLAUDE.md
 * "L'Assistant Finance détaille réellement le retour". Volontairement
 * réduit à une simple confirmation (+ motif si la demande est clôturée) :
 * cette action crée seulement le retour avec une ligne générique "Dépenses
 * non détaillées" à détailler ENSUITE — le vrai détail (libellés réels,
 * pièces jointes, justification) se fait sur l'écran de détail du retour
 * (`DetaillerDepensesForm.tsx`), le MÊME mécanisme que pour un retour
 * réellement soumis par le collaborateur.
 *
 * **`motifReouvertureRequis`** — `true` uniquement si la demande est déjà
 * `CLOTUREE` (réouverture exceptionnelle) : ajoute un champ "Motif de la
 * réouverture exceptionnelle" obligatoire (10 caractères minimum), jamais
 * affiché sinon.
 *
 * Ne réceptionne jamais automatiquement — crée le retour en attente ; la
 * réception reste une étape séparée sur l'écran de détail du retour.
 */
export function DeclarerRetourAssistantForm({
  reglementId,
  montantReglement,
  motifReouvertureRequis,
  modeReglement,
  onCancel,
  onSuccess,
}: {
  reglementId: string;
  montantReglement: number;
  motifReouvertureRequis: boolean;
  /** BANQUE : montant reversé + bordereau de versement OBLIGATOIRES (voir CLAUDE.md "Retour sur règlement Banque"). */
  modeReglement: "CAISSE" | "BANQUE";
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const estBanque = modeReglement === "BANQUE";
  const [montantBanque, setMontantBanque] = useState("");
  const [bordereau, setBordereau] = useState<string | undefined>();
  const [motifReouverture, setMotifReouverture] = useState("");
  const [erreur, setErreur] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    if (motifReouvertureRequis && motifReouverture.trim().length < 10) {
      setErreur("Le motif de réouverture exceptionnelle est obligatoire (10 caractères minimum).");
      return;
    }
    if (estBanque) {
      const m = Number(montantBanque);
      if (!m || m <= 0) {
        setErreur("Le montant reversé doit être supérieur à 0.");
        return;
      }
      if (m > montantReglement) {
        setErreur(`Le montant reversé ne peut pas dépasser le montant du règlement (${montantReglement.toLocaleString("fr-FR")} FCFA).`);
        return;
      }
      if (!bordereau) {
        setErreur("Le bordereau de versement est obligatoire pour un retour Banque.");
        return;
      }
    }
    setErreur(undefined);

    startTransition(async () => {
      const result = await declarerRetourAssistantAction(
        reglementId,
        motifReouvertureRequis ? motifReouverture : undefined,
        estBanque ? bordereau : undefined,
        estBanque ? Number(montantBanque) : undefined
      );
      if (result.status === "success") {
        toast.success(result.message);
        onSuccess();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="animate-fade-in-up space-y-4 rounded-md border border-border p-4">
      <p className="text-xs text-muted-foreground">
        Aucun retour du collaborateur : ceci déclare un retour couvrant l&apos;intégralité du montant réglé (
        {montantReglement.toLocaleString("fr-FR")} FCFA), à détailler ensuite (libellés réels, pièces jointes,
        justification) sur l&apos;écran de détail du retour.
      </p>

      {estBanque ? (
        <div className="space-y-3">
          <Input
            label="Montant reversé à la banque (FCFA)"
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            required
            value={montantBanque}
            onChange={(e) => setMontantBanque(e.target.value)}
          />
          <PieceJointeUpload label="Bordereau de versement (obligatoire)" onChange={(url) => setBordereau(url ?? undefined)} />
        </div>
      ) : null}

      {motifReouvertureRequis ? (
        <Textarea
          label="Motif de la réouverture exceptionnelle"
          hint="Obligatoire (10 caractères minimum) — cette demande est déjà clôturée."
          rows={2}
          value={motifReouverture}
          onChange={(e) => setMotifReouverture(e.target.value)}
        />
      ) : null}

      {erreur ? <p className="text-sm text-danger">{erreur}</p> : null}

      <div className="flex flex-wrap gap-3">
        <Button type="button" loading={isPending} onClick={handleSubmit}>
          Déclarer
        </Button>
        <Button type="button" variant="secondary" disabled={isPending} onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Input, Select, Textarea } from "@/components/ui";
import { JUSTIFICATION_OPTIONS } from "@/components/tresorerie/justification";
import { PieceJointeUpload } from "@/components/tresorerie/PieceJointeUpload";

import { declarerRetourAssistantAction, type LigneDepenseAssistantInput } from "../../retours/retourActions";

type LigneEdit = LigneDepenseAssistantInput & { key: string };

function nouvelleLigne(): LigneEdit {
  return {
    key: `ligne-${Math.random().toString(36).slice(2)}`,
    montant: 0,
    objet: "",
    date: new Date().toISOString().slice(0, 10),
    nature: "",
    justification: "FACTURE",
    commentaire: "",
  };
}

/**
 * Formulaire permettant à l'Assistant Finance de déclarer LUI-MÊME les
 * dépenses d'un règlement Caisse — voir CLAUDE.md "L'Assistant Finance
 * déclare les dépenses sur toute demande, retour ou pas" : "aucun retour
 * du collaborateur, montant réglé considéré comme intégralement dépensé",
 * réparti en dépenses avec justificatif (montant + pièce jointe) et
 * dépenses sans pièce (montant + motif obligatoire, même contrainte que le
 * formulaire Collaborateur détaillé).
 *
 * **`motifReouvertureRequis`** — `true` uniquement si la demande est déjà
 * `CLOTUREE` (Tâche "Réouverture exceptionnelle post-clôture", voir
 * CLAUDE.md) : ajoute un champ "Motif de la réouverture exceptionnelle"
 * obligatoire (10 caractères minimum), jamais affiché sinon (cas normal,
 * demande encore active).
 *
 * Ne réceptionne jamais automatiquement — crée le retour en attente,
 * exactement comme une déclaration du collaborateur ; la réception reste
 * une étape séparée (`ReceptionnerAction`, sur l'écran de détail du
 * retour).
 */
export function DeclarerRetourAssistantForm({
  reglementId,
  montantReglement,
  motifReouvertureRequis,
  onCancel,
  onSuccess,
}: {
  reglementId: string;
  montantReglement: number;
  motifReouvertureRequis: boolean;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [lignes, setLignes] = useState<LigneEdit[]>(() => [nouvelleLigne()]);
  const [motifReouverture, setMotifReouverture] = useState("");
  const [erreur, setErreur] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  const totalDeclare = lignes.reduce((sum, l) => sum + (Number(l.montant) || 0), 0);
  const resteEstime = Math.max(0, montantReglement - totalDeclare);

  function updateLigne(key: string, patch: Partial<LigneEdit>) {
    setLignes((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function ajouterLigne() {
    setLignes((prev) => [...prev, nouvelleLigne()]);
  }

  function retirerLigne(key: string) {
    setLignes((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  function handleSubmit() {
    for (const l of lignes) {
      if (!l.montant || l.montant <= 0) {
        setErreur("Chaque ligne doit avoir un montant supérieur à 0.");
        return;
      }
      if (!l.objet.trim()) {
        setErreur("Chaque ligne doit avoir un objet renseigné.");
        return;
      }
      if (l.justification === "SANS_PIECE" && !l.commentaire?.trim()) {
        setErreur("Un motif est obligatoire pour une ligne sans pièce formelle.");
        return;
      }
    }
    if (motifReouvertureRequis && motifReouverture.trim().length < 10) {
      setErreur("Le motif de réouverture exceptionnelle est obligatoire (10 caractères minimum).");
      return;
    }
    setErreur(undefined);

    startTransition(async () => {
      const lignesPayload = lignes.map((l) => ({
        montant: l.montant,
        objet: l.objet,
        date: l.date,
        nature: l.nature,
        justification: l.justification,
        commentaire: l.commentaire,
        pieceJointeUrl: l.pieceJointeUrl,
      }));
      const result = await declarerRetourAssistantAction(
        reglementId,
        lignesPayload,
        motifReouvertureRequis ? motifReouverture : undefined
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
        Aucun retour du collaborateur : déclarez ici la répartition réelle du montant réglé (
        {montantReglement.toLocaleString("fr-FR")} FCFA) — dépenses avec justificatif ou sans pièce formelle
        (motif obligatoire dans ce cas).
      </p>

      {motifReouvertureRequis ? (
        <Textarea
          label="Motif de la réouverture exceptionnelle"
          hint="Obligatoire (10 caractères minimum) — cette demande est déjà clôturée."
          rows={2}
          value={motifReouverture}
          onChange={(e) => setMotifReouverture(e.target.value)}
        />
      ) : null}

      <div className="space-y-4">
        {lignes.map((ligne, index) => (
          <div key={ligne.key} className="animate-fade-in-up space-y-3 rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Dépense {index + 1}
              </p>
              {lignes.length > 1 ? (
                <Button type="button" variant="secondary" onClick={() => retirerLigne(ligne.key)}>
                  Retirer
                </Button>
              ) : null}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                label="Montant"
                type="number"
                inputMode="decimal"
                min="0"
                step="1"
                required
                value={ligne.montant || ""}
                onChange={(e) => updateLigne(ligne.key, { montant: Number(e.target.value) })}
              />
              <Input
                label="Objet"
                required
                value={ligne.objet}
                onChange={(e) => updateLigne(ligne.key, { objet: e.target.value })}
              />
              <Input
                label="Date"
                type="date"
                required
                value={ligne.date}
                onChange={(e) => updateLigne(ligne.key, { date: e.target.value })}
              />
              <Input
                label="Nature"
                hint="Optionnel"
                value={ligne.nature ?? ""}
                onChange={(e) => updateLigne(ligne.key, { nature: e.target.value })}
              />
              <Select
                label="Justification"
                required
                options={JUSTIFICATION_OPTIONS}
                defaultValue={ligne.justification}
                onChange={(e) =>
                  updateLigne(ligne.key, {
                    justification: e.target.value as LigneDepenseAssistantInput["justification"],
                  })
                }
              />
            </div>
            <Textarea
              label="Motif / commentaire"
              rows={2}
              hint="Obligatoire si la justification est « Dépense sans pièce formelle » — c'est ici le motif de Finance/l'Assistant, pas celui du collaborateur."
              value={ligne.commentaire ?? ""}
              onChange={(e) => updateLigne(ligne.key, { commentaire: e.target.value })}
            />
            <PieceJointeUpload
              label="Pièce jointe transmise par le collaborateur (facultatif)"
              onChange={(url) => updateLigne(ligne.key, { pieceJointeUrl: url ?? undefined })}
            />
          </div>
        ))}
      </div>

      <Button type="button" variant="secondary" onClick={ajouterLigne}>
        Ajouter une ligne de dépense
      </Button>

      <div className="grid grid-cols-1 gap-4 rounded-md bg-muted p-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total dépensé (saisi)</p>
          <p className="text-sm font-semibold text-foreground">{totalDeclare.toLocaleString("fr-FR")} FCFA</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            À retourner (estimation, recalculé côté serveur)
          </p>
          <p className="text-sm font-semibold text-foreground">{resteEstime.toLocaleString("fr-FR")} FCFA</p>
        </div>
      </div>

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

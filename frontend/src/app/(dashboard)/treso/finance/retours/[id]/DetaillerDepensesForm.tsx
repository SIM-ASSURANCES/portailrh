"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Input, Select, Textarea } from "@/components/ui";
import { PieceJointeUpload } from "@/components/tresorerie/PieceJointeUpload";

import { detaillerDepensesRetourAction, type LigneDetailInput } from "../retourActions";

type LigneEdit = LigneDetailInput & { key: string };

function nouvelleLigne(): LigneEdit {
  return {
    key: `ligne-${Math.random().toString(36).slice(2)}`,
    libelle: "",
    montant: 0,
    pieceJointeFournie: false,
    pieceJointeUrl: undefined,
    justifiee: true,
    motif: "",
  };
}

/**
 * Formulaire UNIFIÉ de détail réel d'un retour de caisse — voir CLAUDE.md
 * "L'Assistant Finance détaille réellement le retour" : remplace la ou les
 * lignes actuelles du retour (générique "Dépenses non détaillées" ou détail
 * déjà saisi) par un détail réel — un ou plusieurs libellés/montants,
 * chacun avec pièce jointe (ou mention explicite d'absence) et statut
 * justifié/non justifié (motif obligatoire sinon).
 *
 * **Prérempli depuis les lignes ACTUELLES du retour** (`lignesInitiales`) :
 * l'Assistant part de l'existant plutôt que de tout ressaisir, y compris
 * pour corriger un détail déjà renseigné suite à un signalement.
 *
 * **Validation de la somme côté client, en plus du serveur** : le total
 * saisi doit égaler exactement `montantCible` (le total dépensé déjà
 * établi pour ce retour, jamais modifié par cette action) — écart affiché
 * en temps réel pour guider la saisie, refus serveur si incohérent malgré
 * tout (contournement du formulaire).
 */
export function DetaillerDepensesForm({
  retourId,
  montantCible,
  lignesInitiales,
  onCancel,
  onSuccess,
}: {
  retourId: string;
  montantCible: number;
  lignesInitiales: LigneDetailInput[];
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [lignes, setLignes] = useState<LigneEdit[]>(() =>
    lignesInitiales.length > 0 ? lignesInitiales.map((l) => ({ ...l, key: `ligne-${Math.random().toString(36).slice(2)}` })) : [nouvelleLigne()]
  );
  const [erreur, setErreur] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  const totalSaisi = lignes.reduce((sum, l) => sum + (Number(l.montant) || 0), 0);
  const ecart = Math.round((totalSaisi - montantCible) * 100) / 100;

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
      if (!l.libelle.trim()) {
        setErreur("Chaque ligne doit avoir un libellé décrivant l'usage réel de la dépense.");
        return;
      }
      if (!l.montant || l.montant <= 0) {
        setErreur("Chaque ligne doit avoir un montant supérieur à 0.");
        return;
      }
      if (l.pieceJointeFournie && !l.pieceJointeUrl) {
        setErreur("Téléversez le fichier, ou indiquez qu'aucune pièce jointe n'est fournie pour cette ligne.");
        return;
      }
      if (!l.justifiee && (!l.motif || l.motif.trim().length < 3)) {
        setErreur("Un motif (3 caractères minimum) est obligatoire pour une ligne non justifiée.");
        return;
      }
    }
    if (Math.round(totalSaisi * 100) !== Math.round(montantCible * 100)) {
      setErreur(
        `La somme des lignes (${totalSaisi.toLocaleString("fr-FR")} FCFA) doit égaler le total dépensé (${montantCible.toLocaleString("fr-FR")} FCFA) — écart de ${Math.abs(ecart).toLocaleString("fr-FR")} FCFA ${ecart > 0 ? "en trop" : "manquant"}.`
      );
      return;
    }
    setErreur(undefined);

    startTransition(async () => {
      const payload: LigneDetailInput[] = lignes.map((l) => ({
        libelle: l.libelle,
        montant: l.montant,
        pieceJointeFournie: l.pieceJointeFournie,
        pieceJointeUrl: l.pieceJointeFournie ? l.pieceJointeUrl : undefined,
        justifiee: l.justifiee,
        motif: l.justifiee ? undefined : l.motif,
      }));
      const result = await detaillerDepensesRetourAction(retourId, payload);
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
        Total dépensé à détailler : <span className="font-semibold text-foreground">{montantCible.toLocaleString("fr-FR")} FCFA</span> — la
        somme des lignes ci-dessous doit égaler exactement ce montant.
      </p>

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
                label="Libellé / usage réel"
                hint='Ex : "Transport pour livraison X"'
                required
                value={ligne.libelle}
                onChange={(e) => updateLigne(ligne.key, { libelle: e.target.value })}
              />
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
            </div>

            <Select
              label="Pièce jointe"
              options={[
                { value: "non", label: "Aucune pièce jointe fournie" },
                { value: "oui", label: "Pièce jointe fournie" },
              ]}
              value={ligne.pieceJointeFournie ? "oui" : "non"}
              onChange={(e) => updateLigne(ligne.key, { pieceJointeFournie: e.target.value === "oui", pieceJointeUrl: undefined })}
            />
            {ligne.pieceJointeFournie ? (
              <PieceJointeUpload
                label="Fichier transmis par le collaborateur en interne"
                onChange={(url) => updateLigne(ligne.key, { pieceJointeUrl: url ?? undefined })}
              />
            ) : null}

            <Select
              label="Statut"
              options={[
                { value: "justifiee", label: "Justifiée" },
                { value: "non_justifiee", label: "Non justifiée" },
              ]}
              value={ligne.justifiee ? "justifiee" : "non_justifiee"}
              onChange={(e) => updateLigne(ligne.key, { justifiee: e.target.value === "justifiee" })}
            />
            {!ligne.justifiee ? (
              <Textarea
                label="Motif (non justifiée)"
                rows={2}
                required
                hint="Obligatoire (3 caractères minimum)."
                value={ligne.motif ?? ""}
                onChange={(e) => updateLigne(ligne.key, { motif: e.target.value })}
              />
            ) : null}
          </div>
        ))}
      </div>

      <Button type="button" variant="secondary" onClick={ajouterLigne}>
        Ajouter une ligne de dépense
      </Button>

      <div className="grid grid-cols-1 gap-4 rounded-md bg-muted p-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total saisi</p>
          <p className="text-sm font-semibold text-foreground">{totalSaisi.toLocaleString("fr-FR")} FCFA</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Écart avec le total dépensé</p>
          <p className={`text-sm font-semibold ${ecart === 0 ? "text-success" : "text-danger"}`}>
            {ecart === 0 ? "Aucun écart" : `${ecart > 0 ? "+" : ""}${ecart.toLocaleString("fr-FR")} FCFA`}
          </p>
        </div>
      </div>

      {erreur ? <p className="text-sm text-danger">{erreur}</p> : null}

      <div className="flex flex-wrap gap-3">
        <Button type="button" loading={isPending} onClick={handleSubmit}>
          Enregistrer le détail
        </Button>
        <Button type="button" variant="secondary" disabled={isPending} onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </div>
  );
}

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
 * Décomposition du montant total déclaré par le collaborateur (voir
 * CLAUDE.md "Décomposition du montant déclaré") : l'Assistant Finance répartit
 * ce total en plusieurs entrées, chacune typée —
 * - **Dépense justifiée** : montant + motif + pièce jointe OBLIGATOIRE ;
 * - **Dépense sans pièce formelle** : montant + motif OBLIGATOIRE, aucune
 *   pièce jointe demandée.
 *
 * Un SEUL champ texte "Motif" par entrée (stocké comme libellé de la ligne ;
 * pour une dépense sans pièce formelle, aussi comme motif Finance). La somme
 * ne peut jamais dépasser `montantCible` (revérifié côté serveur) ; si elle
 * est inférieure, le reste demeure "Dépenses non détaillées".
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
  onCancel?: () => void;
  onSuccess?: () => void;
}) {
  const [lignes, setLignes] = useState<LigneEdit[]>(() =>
    lignesInitiales.length > 0
      ? lignesInitiales.map((l) => ({
          ...l,
          motif: l.justifiee ? l.libelle : (l.motif ?? l.libelle),
          key: `ligne-${Math.random().toString(36).slice(2)}`,
        }))
      : [nouvelleLigne()]
  );
  const [erreur, setErreur] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  const totalSaisi = lignes.reduce((sum, l) => sum + (Number(l.montant) || 0), 0);
  const reste = Math.round((montantCible - totalSaisi) * 100) / 100;

  function updateLigne(key: string, patch: Partial<LigneEdit>) {
    setLignes((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function handleSubmit() {
    for (const l of lignes) {
      if (!l.montant || l.montant <= 0) {
        setErreur("Chaque entrée doit avoir un montant supérieur à 0.");
        return;
      }
      if (!l.motif || l.motif.trim().length < 3) {
        setErreur("Un motif (3 caractères minimum) est obligatoire pour chaque entrée.");
        return;
      }
      if (l.justifiee && (!l.pieceJointeFournie || !l.pieceJointeUrl)) {
        setErreur("Une pièce jointe est obligatoire pour une dépense justifiée.");
        return;
      }
    }
    if (reste < 0) {
      setErreur(
        `La somme des entrées (${totalSaisi.toLocaleString("fr-FR")} FCFA) dépasse le montant total déclaré (${montantCible.toLocaleString("fr-FR")} FCFA) — ${Math.abs(reste).toLocaleString("fr-FR")} FCFA en trop.`
      );
      return;
    }
    setErreur(undefined);

    startTransition(async () => {
      const payload: LigneDetailInput[] = lignes.map((l) => ({
        libelle: l.motif!.trim(),
        montant: l.montant,
        pieceJointeFournie: l.justifiee,
        pieceJointeUrl: l.justifiee ? l.pieceJointeUrl : undefined,
        justifiee: l.justifiee,
        motif: l.justifiee ? undefined : l.motif!.trim(),
      }));
      const result = await detaillerDepensesRetourAction(retourId, payload);
      if (result.status === "success") {
        toast.success(result.message);
        onSuccess?.();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="animate-fade-in-up w-full space-y-4 rounded-md border border-border p-4">
      <p className="text-xs text-muted-foreground">
        Montant total déclaré par le collaborateur :{" "}
        <span className="font-semibold text-foreground">{montantCible.toLocaleString("fr-FR")} FCFA</span> — répartissez-le
        en une ou plusieurs entrées (la somme ne peut pas le dépasser).
      </p>

      <div className="space-y-4">
        {lignes.map((ligne, index) => (
          <div key={ligne.key} className="animate-fade-in-up space-y-3 rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Entrée {index + 1}</p>
              {lignes.length > 1 ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setLignes((prev) => prev.filter((l) => l.key !== ligne.key))}
                >
                  Retirer
                </Button>
              ) : null}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select
                label="Type"
                options={[
                  { value: "justifiee", label: "Dépense justifiée" },
                  { value: "sans_piece", label: "Dépense sans pièce formelle" },
                ]}
                value={ligne.justifiee ? "justifiee" : "sans_piece"}
                onChange={(e) =>
                  updateLigne(ligne.key, {
                    justifiee: e.target.value === "justifiee",
                    pieceJointeFournie: e.target.value === "justifiee",
                    pieceJointeUrl: undefined,
                  })
                }
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
            <Textarea
              label="Motif"
              rows={2}
              required
              hint={
                ligne.justifiee
                  ? "Nature/usage de la dépense (3 caractères minimum)."
                  : "Pourquoi il n'existe aucun justificatif (3 caractères minimum)."
              }
              value={ligne.motif ?? ""}
              onChange={(e) => updateLigne(ligne.key, { motif: e.target.value })}
            />
            {ligne.justifiee ? (
              <PieceJointeUpload
                label="Pièce jointe (obligatoire)"
                onChange={(url) => updateLigne(ligne.key, { pieceJointeUrl: url ?? undefined, pieceJointeFournie: true })}
              />
            ) : null}
          </div>
        ))}
      </div>

      <Button type="button" variant="secondary" onClick={() => setLignes((prev) => [...prev, nouvelleLigne()])}>
        Ajouter une entrée
      </Button>

      <div className="grid grid-cols-1 gap-4 rounded-md bg-muted p-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total saisi</p>
          <p className="text-sm font-semibold text-foreground">{totalSaisi.toLocaleString("fr-FR")} FCFA</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reste non détaillé</p>
          <p className={`text-sm font-semibold ${reste < 0 ? "text-danger" : "text-foreground"}`}>
            {reste < 0 ? `${Math.abs(reste).toLocaleString("fr-FR")} FCFA en trop` : `${reste.toLocaleString("fr-FR")} FCFA`}
          </p>
        </div>
      </div>

      {erreur ? <p className="text-sm text-danger">{erreur}</p> : null}

      <div className="flex flex-wrap gap-3">
        <Button type="button" loading={isPending} onClick={handleSubmit}>
          Enregistrer le détail
        </Button>
        {onCancel ? (
          <Button type="button" variant="secondary" disabled={isPending} onClick={onCancel}>
            Annuler
          </Button>
        ) : null}
      </div>
    </div>
  );
}

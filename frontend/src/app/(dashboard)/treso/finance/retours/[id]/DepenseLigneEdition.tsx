"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button, Input, Select, Textarea } from "@/components/ui";
import { PieceJointeUpload } from "@/components/tresorerie/PieceJointeUpload";

import { MOTIF_MODIFICATION_DEPENSE_MIN } from "backend/client";

import { modifierDepenseDetailleeAction } from "../retourActions";

/**
 * Corriger UNE dépense détaillée (2026-10-10) : mêmes champs que la saisie (type avec ou sans pièce formelle, libellé,
 * montant, motif d'une dépense sans pièce, pièce jointe) et un motif de modification obligatoire, tracé dans
 * l'historique avec les valeurs avant/après. Pas de suppression : une ligne saisie par erreur se corrige en la modifiant.
 * Le serveur revérifie tout (permission, garde 8, clôture, montant).
 */
export function DepenseLigneEdition({
  depense,
}: {
  depense: { id: string; libelle: string; montant: number; justifiee: boolean; motifNonJustifie: string | null; aPieceJointe: boolean };
}) {
  const [mode, setMode] = useState<"repos" | "modifier">("repos");
  const [libelle, setLibelle] = useState(depense.libelle);
  const [montant, setMontant] = useState(String(depense.montant));
  const [justifiee, setJustifiee] = useState(depense.justifiee);
  const [motifNonJustifie, setMotifNonJustifie] = useState(depense.motifNonJustifie ?? "");
  const [pieceJointeUrl, setPieceJointeUrl] = useState<string | undefined>();
  const [motif, setMotif] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const motifValide = motif.trim().length >= MOTIF_MODIFICATION_DEPENSE_MIN;
  const pieceManquante = justifiee && !pieceJointeUrl && !depense.aPieceJointe;

  function envoyer(appel: () => Promise<{ status: string; message: string }>) {
    startTransition(async () => {
      const r = await appel();
      if (r.status === "success") {
        toast.success(r.message);
        setMode("repos");
        setMotif("");
        router.refresh();
      } else {
        toast.error(r.message);
      }
    });
  }

  if (mode === "repos") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => setMode("modifier")}>
          Modifier
        </Button>
      </div>
    );
  }

  const champMotif = (
    <Textarea
      label="Motif de la modification"
      required
      rows={2}
      value={motif}
      onChange={(e) => setMotif(e.target.value)}
      hint="Inscrit dans l'historique de la demande."
      error={motif.length > 0 && !motifValide ? `${MOTIF_MODIFICATION_DEPENSE_MIN} caractères minimum.` : undefined}
    />
  );

  return (
    <div data-edition-depense className="space-y-3 rounded-md border border-border bg-muted/40 p-3">
      {mode === "modifier" ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label="Type"
              options={[
                { value: "justifiee", label: "Dépense justifiée" },
                { value: "sans_piece", label: "Dépense sans pièce formelle" },
              ]}
              value={justifiee ? "justifiee" : "sans_piece"}
              onChange={(e) => setJustifiee(e.target.value === "justifiee")}
            />
            <Input label="Montant" type="number" inputMode="decimal" min="0" step="1" required value={montant} onChange={(e) => setMontant(e.target.value)} />
          </div>
          <Input label="Libellé" required value={libelle} onChange={(e) => setLibelle(e.target.value)} />
          {!justifiee ? (
            <Textarea
              label="Pourquoi aucun justificatif"
              required
              rows={2}
              value={motifNonJustifie}
              onChange={(e) => setMotifNonJustifie(e.target.value)}
            />
          ) : (
            <PieceJointeUpload
              label={depense.aPieceJointe ? "Remplacer la pièce jointe (facultatif)" : "Pièce jointe (obligatoire)"}
              onChange={(url) => setPieceJointeUrl(url ?? undefined)}
            />
          )}
          {champMotif}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              loading={isPending}
              disabled={!motifValide || pieceManquante || !(Number(montant) > 0) || !libelle.trim() || isPending}
              onClick={() =>
                envoyer(() =>
                  modifierDepenseDetailleeAction(
                    depense.id,
                    { libelle: libelle.trim(), montant: Number(montant), justifiee, pieceJointeUrl, motifNonJustifie: justifiee ? undefined : motifNonJustifie },
                    motif
                  )
                )
              }
            >
              Enregistrer la modification
            </Button>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => setMode("repos")}>
              Annuler
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

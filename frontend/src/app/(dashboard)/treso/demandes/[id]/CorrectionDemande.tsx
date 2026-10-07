"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Icon } from "@/components/icons";
import { formatMontantDevise } from "@/components/tresorerie/devise";
import { PieceJointeUpload } from "@/components/tresorerie/PieceJointeUpload";
import { Button, Input, Textarea } from "@/components/ui";

import { abandonnerDemandeAction, corrigerEtResoumettreDemandeAction } from "../../circuit/actions";

export interface LigneACorriger {
  id: string;
  libelle: string;
  quantite: number;
  prixUnitaire: number;
}

type LigneEdit = { key: string; id?: string; libelle: string; quantite: number; prixUnitaire: string };

let compteur = 0;
const cle = () => `n${++compteur}`;

/**
 * « À corriger » (circuit de validation, commit 4) : le demandeur corrige sa demande (lignes, montants, motif, pièce
 * jointe) et la resoumet, ou l'abandonne après confirmation. Le serveur (`corrigerEtResoumettre`) recopie la version
 * précédente dans l'historique avant toute modification et revérifie tout : seul le demandeur, et seulement à
 * l'étape « À corriger ». Une dépense directe n'a pas de lignes : son montant reste celui de la saisie.
 */
export function CorrectionDemande({
  demandeId,
  avecLignes,
  descriptionInitiale,
  lignesInitiales,
  devise,
}: {
  demandeId: string;
  avecLignes: boolean;
  descriptionInitiale: string;
  lignesInitiales: LigneACorriger[];
  devise: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<"idle" | "corriger" | "abandonner">("idle");
  const [description, setDescription] = useState(descriptionInitiale);
  const [pieceJointeUrl, setPieceJointeUrl] = useState<string | null>(null);
  const [lignes, setLignes] = useState<LigneEdit[]>(() =>
    lignesInitiales.map((l) => ({ key: l.id, id: l.id, libelle: l.libelle, quantite: l.quantite, prixUnitaire: String(l.prixUnitaire) }))
  );

  const total = lignes.reduce((s, l) => s + (Number(l.quantite) || 0) * (Number(l.prixUnitaire) || 0), 0);
  const maj = (key: string, patch: Partial<LigneEdit>) => setLignes((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function resoumettre() {
    startTransition(async () => {
      const r = await corrigerEtResoumettreDemandeAction(demandeId, {
        description,
        lignes: lignes.map((l) => ({
          id: l.id,
          libelle: l.libelle,
          quantite: Number(l.quantite),
          prixUnitaire: Number(l.prixUnitaire) || 0,
        })),
        pieceJointeUrl: pieceJointeUrl ?? undefined,
      });
      if (r.status === "success") {
        toast.success(r.message);
        setMode("idle");
        router.refresh();
      } else toast.error(r.message);
    });
  }

  function abandonner() {
    startTransition(async () => {
      const r = await abandonnerDemandeAction(demandeId);
      if (r.status === "success") {
        toast.success(r.message);
        setMode("idle");
        router.refresh();
      } else toast.error(r.message);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={isPending || mode === "corriger"} onClick={() => setMode("corriger")}>
          Corriger et resoumettre
        </Button>
        <Button type="button" variant="danger" disabled={isPending || mode === "abandonner"} onClick={() => setMode("abandonner")}>
          Abandonner
        </Button>
      </div>

      {mode === "abandonner" ? (
        <div className="space-y-3 rounded-lg border border-danger bg-danger-bg p-4">
          <p className="text-sm text-danger">
            Abandonner la demande est définitif : elle ne pourra plus être corrigée ni resoumise. Confirmez-vous
            l&apos;abandon&nbsp;?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="danger" loading={isPending} onClick={abandonner}>
              Confirmer l&apos;abandon
            </Button>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => setMode("idle")}>
              Annuler
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "corriger" ? (
        <div className="animate-fade-in-up space-y-4 rounded-lg border border-border p-4">
          {avecLignes ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Articles</p>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setLignes((ls) => [...ls, { key: cle(), libelle: "", quantite: 1, prixUnitaire: "" }])}
                >
                  <Icon name="plus-circle" className="size-4" />
                  Ajouter une ligne
                </Button>
              </div>
              {lignes.map((l) => (
                <div
                  key={l.key}
                  data-ligne-correction
                  className="grid gap-2 border-b border-border pb-3 last:border-b-0 sm:grid-cols-[1fr_90px_140px_120px_36px] sm:items-center sm:gap-3"
                >
                  <Input aria-label="Libellé de l'article" value={l.libelle} onChange={(e) => maj(l.key, { libelle: e.target.value })} />
                  <Input
                    aria-label="Nombre"
                    type="number"
                    min="1"
                    step="1"
                    value={l.quantite}
                    onChange={(e) => maj(l.key, { quantite: Number(e.target.value) })}
                  />
                  <Input
                    aria-label="Prix unitaire"
                    type="number"
                    min="0"
                    step="1"
                    placeholder="0"
                    value={l.prixUnitaire}
                    onChange={(e) => maj(l.key, { prixUnitaire: e.target.value })}
                  />
                  <span className="text-sm font-bold tabular-nums text-foreground sm:text-right">
                    {formatMontantDevise((Number(l.quantite) || 0) * (Number(l.prixUnitaire) || 0), devise)}
                  </span>
                  <div className="flex justify-end">
                    {lignes.length > 1 ? (
                      <button
                        type="button"
                        aria-label="Retirer la ligne"
                        onClick={() => setLignes((ls) => ls.filter((x) => x.key !== l.key))}
                        className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-danger-bg hover:text-danger"
                      >
                        <Icon name="x" className="size-4" />
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
              <p className="text-right text-sm font-bold text-foreground">
                Nouveau total : <span className="tabular-nums">{formatMontantDevise(total, devise)}</span>
              </p>
            </div>
          ) : null}

          <Textarea
            label="Motif de l'achat"
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            error={description.trim().length > 0 && description.trim().length < 3 ? "3 caractères minimum." : undefined}
          />
          <PieceJointeUpload
            label="Nouvelle pièce jointe"
            hint="PDF, JPG ou PNG — 10 Mo maximum. Optionnel : les pièces déjà jointes sont conservées."
            onChange={setPieceJointeUrl}
          />
          <p className="text-xs text-muted-foreground">
            La version actuelle est conservée dans l&apos;historique. La demande repart au début du circuit.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" loading={isPending} disabled={description.trim().length < 3} onClick={resoumettre}>
              Resoumettre la demande
            </Button>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => setMode("idle")}>
              Annuler
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

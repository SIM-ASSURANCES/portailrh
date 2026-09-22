"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Textarea } from "@/components/ui";

import { modifierDescriptionAction } from "./actions";

/**
 * Affichage + édition de la "Description du besoin" (`Demande.description`,
 * le motif écrit par le collaborateur créateur à la création de sa
 * demande — PAS un champ lié au catalogue Catégorie/Objet) — Tâche
 * "Description du besoin modifiable avec traçabilité permanente" (voir
 * CLAUDE.md).
 *
 * **Libellés volontairement explicites ("Description du besoin — version
 * initiale/modifiée"), jamais "Demande initiale"/"Demande modifiée"**
 * (correctif suite à une confusion réelle constatée — voir CLAUDE.md
 * "Correction : le bon champ était déjà ciblé") : ces anciens libellés
 * laissaient penser à tort qu'une AUTRE entité (la "Demande" dans son
 * ensemble, ou pire le catalogue Catégorie/Objet dont les entrées portent
 * elles-mêmes un "libellé") pouvait être concernée, alors qu'il ne s'agit
 * QUE de ce seul champ texte.
 *
 * **Les deux versions restent visibles EN PERMANENCE dès qu'elles
 * divergent** — jamais un remplacement silencieux, jamais besoin de
 * cliquer pour voir l'ancienne version : `descriptionOriginale` (si non
 * `null`) est toujours affichée à côté de `description` (courante),
 * clairement labellisées, jamais l'une masquant l'autre.
 *
 * **`disabled`** — le déclencheur "Modifier" reste VISIBLE mais désactivé
 * (jamais absent) pour un compte sans `treso.valider_demande`/
 * `treso.effectuer_reglement` (ex: DG) ou une fois la demande `CLOTUREE` —
 * même principe "visible mais désactivé" que le reste du module (voir
 * `ValidationActions`/`ReglementForm`). Ce composant est TOUJOURS rendu
 * (jamais conditionné à une permission côté page appelante).
 */
export function DescriptionEditor({
  demandeId,
  description,
  descriptionOriginale,
  disabled = false,
}: {
  demandeId: string;
  description: string;
  descriptionOriginale: string | null;
  disabled?: boolean;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [valeur, setValeur] = useState(description);
  const [erreur, setErreur] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  function handleEnregistrer() {
    if (valeur.trim().length < 3) {
      setErreur("La description doit contenir au moins 3 caractères.");
      return;
    }
    setErreur(undefined);
    startTransition(async () => {
      const result = await modifierDescriptionAction(demandeId, valeur.trim());
      if (result.status === "success") {
        toast.success(result.message);
        setOuvert(false);
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="sm:col-span-2 space-y-3">
      {descriptionOriginale != null ? (
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Description du besoin — version initiale (saisie par le collaborateur)
          </dt>
          <dd className="text-sm text-muted-foreground">{descriptionOriginale}</dd>
        </div>
      ) : null}
      <div>
        <dt className="flex items-center justify-between gap-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <span>
            {descriptionOriginale != null ? "Description du besoin — version modifiée" : "Description du besoin"}
          </span>
          {!ouvert ? (
            <button
              type="button"
              disabled={disabled}
              className="text-xs font-medium normal-case text-info underline-offset-4 hover:text-primary hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline disabled:hover:text-muted-foreground"
              onClick={() => {
                setValeur(description);
                setOuvert(true);
              }}
            >
              Modifier
            </button>
          ) : null}
        </dt>
        {!ouvert ? (
          <dd className="text-sm text-foreground">{description}</dd>
        ) : (
          <div className="animate-fade-in-up mt-1 space-y-2">
            <Textarea
              aria-label="Description du besoin"
              rows={4}
              value={valeur}
              onChange={(e) => {
                setValeur(e.target.value);
                if (erreur) setErreur(undefined);
              }}
              error={erreur}
            />
            <div className="flex flex-wrap gap-3">
              <Button type="button" loading={isPending} onClick={handleEnregistrer}>
                Enregistrer
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={isPending}
                onClick={() => {
                  setOuvert(false);
                  setErreur(undefined);
                }}
              >
                Annuler
              </Button>
            </div>
          </div>
        )}
      </div>
      {disabled ? (
        <p className="text-xs text-muted-foreground">
          Votre rôle ne permet pas de modifier la description, ou cette demande est clôturée.
        </p>
      ) : null}
    </div>
  );
}

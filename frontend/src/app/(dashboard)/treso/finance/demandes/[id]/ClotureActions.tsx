"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Textarea } from "@/components/ui";

import { MOTIF_CLOTURE_FORCEE_MIN } from "backend/client";

import { cloturerDemandeAction } from "./actions";

type Mode = "idle" | "totale" | "partielle" | "forcee";

/** Article validé qui n'est pas terminé (lot C) : ce qui l'empêche d'être clôturé. */
export interface ArticleBloquantVue {
  libelle: string;
  beneficiaire: string;
  manques: string[];
  solde: number;
}

/**
 * Boutons "Clôturer totalement" / "Clôturer partiellement" d'une demande
 * VALIDEE. Réservés (au niveau de la page appelante) à
 * `treso.cloturer_demande` — même principe que `ValidationActions.tsx`
 * (Ticket 3) : ne jamais supposer cette permission acquise ailleurs dans
 * l'espace Finance partagé.
 *
 * Clôture totale : motif libre optionnel (simple commentaire de clôture).
 * Clôture partielle : motif obligatoire (min 3 caractères), refusé côté
 * serveur sans lui — revérifié dans `cloturerDemandeAction`, jamais
 * uniquement via ce contrôle client.
 */
export function ClotureActions({
  demandeId,
  bloquants = [],
  refusForcee = null,
}: {
  demandeId: string;
  /** Lot C : articles validés pas encore terminés (réglés en entier et à solde nul). Non vide = clôture normale bloquée. */
  bloquants?: ArticleBloquantVue[];
  /** Lot C : raison pour laquelle CE compte ne peut pas forcer la clôture (garde 8), sinon `null`. */
  refusForcee?: string | null;
}) {
  const bloquee = bloquants.length > 0;
  const [mode, setMode] = useState<Mode>("idle");
  const [motif, setMotif] = useState("");
  const [motifError, setMotifError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  function handleCloturer(type: "TOTALE" | "PARTIELLE" | "FORCEE") {
    if (type === "PARTIELLE" && motif.trim().length < 3) {
      setMotifError("Le motif de la clôture partielle est obligatoire (3 caractères minimum).");
      return;
    }
    if (type === "FORCEE" && motif.trim().length < MOTIF_CLOTURE_FORCEE_MIN) {
      setMotifError(`Le motif de la clôture forcée est obligatoire (${MOTIF_CLOTURE_FORCEE_MIN} caractères minimum).`);
      return;
    }
    setMotifError(undefined);
    startTransition(async () => {
      const result = await cloturerDemandeAction(demandeId, type, motif || undefined);
      if (result.status === "success") {
        toast.success(result.message);
        setMode("idle");
        setMotif("");
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold text-foreground">Clôture</h2>

      {bloquee ? (
        <div data-cloture-bloquee className="space-y-2 rounded-md bg-warning-bg px-3 py-3 text-sm text-warning">
          <p className="font-semibold">
            Clôture impossible : {bloquants.length} article{bloquants.length > 1 ? "s" : ""} non terminé
            {bloquants.length > 1 ? "s" : ""} (réglé en entier et à solde nul).
          </p>
          <ul className="list-disc space-y-1 pl-5">
            {bloquants.map((b, i) => (
              <li key={i} data-article-bloquant>
                « {b.libelle} » (bénéficiaire {b.beneficiaire}) : {b.manques.join(", ")}
              </li>
            ))}
          </ul>
          <p>Régularisez-les, ou forcez la clôture avec un motif.</p>
        </div>
      ) : null}

      {mode === "idle" ? (
        <div className="flex flex-wrap gap-3">
          <Button type="button" disabled={bloquee} onClick={() => setMode("totale")}>
            Clôturer totalement
          </Button>
          <Button type="button" variant="secondary" disabled={bloquee} onClick={() => setMode("partielle")}>
            Clôturer partiellement
          </Button>
          {bloquee ? (
            <Button type="button" variant="danger" data-forcer-cloture disabled={refusForcee !== null} onClick={() => setMode("forcee")}>
              Forcer la clôture
            </Button>
          ) : null}
        </div>
      ) : null}
      {mode === "idle" && bloquee && refusForcee ? (
        <p className="text-sm font-semibold text-foreground">{refusForcee}</p>
      ) : null}

      {mode === "totale" ? (
        <div className="animate-fade-in-up space-y-3">
          <p className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning">
            Confirmer la clôture totale ? Cette action est <strong>définitive</strong> : plus aucun
            règlement, retour ou clôture ne sera possible sur cette demande.
          </p>
          <Textarea
            label="Commentaire"
            rows={2}
            hint="Optionnel."
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
          />
          <div className="flex flex-wrap gap-3">
            <Button signe type="button" loading={isPending} onClick={() => handleCloturer("TOTALE")}>
              Confirmer la clôture totale
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isPending}
              onClick={() => {
                setMode("idle");
                setMotif("");
              }}
            >
              Annuler
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "forcee" ? (
        <div className="animate-fade-in-up space-y-3">
          <p className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
            Confirmer la clôture <strong>forcée</strong> ? Elle est <strong>définitive</strong>, sans régularisation des articles
            listés ci-dessus : leurs soldes restants seront tracés (historique, reporting), le demandeur et le DG seront prévenus.
            Aucune écriture de caisse n&apos;est modifiée.
          </p>
          <Textarea
            label="Motif de la clôture forcée"
            required
            rows={3}
            hint={`${MOTIF_CLOTURE_FORCEE_MIN} caractères minimum.`}
            placeholder="Expliquez pourquoi ces articles ne seront jamais régularisés..."
            value={motif}
            onChange={(e) => {
              setMotif(e.target.value);
              if (motifError) setMotifError(undefined);
            }}
            error={motifError}
          />
          <div className="flex flex-wrap gap-3">
            <Button signe type="button" variant="danger" loading={isPending} onClick={() => handleCloturer("FORCEE")}>
              Confirmer la clôture forcée
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isPending}
              onClick={() => {
                setMode("idle");
                setMotif("");
                setMotifError(undefined);
              }}
            >
              Annuler
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "partielle" ? (
        <div className="animate-fade-in-up space-y-3">
          <p className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning">
            Confirmer la clôture partielle ? Cette action est <strong>définitive</strong> : plus aucun
            règlement, retour ou clôture ne sera possible sur cette demande.
          </p>
          <Textarea
            label="Motif de la clôture partielle"
            required
            rows={3}
            placeholder="Expliquez ce qui reste non justifié..."
            value={motif}
            onChange={(e) => {
              setMotif(e.target.value);
              if (motifError) setMotifError(undefined);
            }}
            error={motifError}
          />
          <div className="flex flex-wrap gap-3">
            <Button signe type="button" loading={isPending} onClick={() => handleCloturer("PARTIELLE")}>
              Confirmer la clôture partielle
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isPending}
              onClick={() => {
                setMode("idle");
                setMotif("");
                setMotifError(undefined);
              }}
            >
              Annuler
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

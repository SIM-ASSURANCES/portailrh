"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Textarea } from "@/components/ui";

import { resoumettreAuDGAction, soumettreAuDGAction } from "../../../circuit/actions";
import { rejeterDemandeAction } from "./actions";

const MOTIF_MIN = 3;

/**
 * Actions de la Finance dans le circuit de validation (commit 4, 2026-10-06), à côté de la décision ligne par ligne :
 * - étape Finance (et décision finale) : « Soumettre au DG », « Rejeter la demande » (motif obligatoire, renvoi au
 *   demandeur) ;
 * - après un rejet du DG : « Resoumettre au DG », « Rejeter vers le collaborateur » (motif obligatoire).
 * Toujours VISIBLES ; grisées hors de l'étape de la Finance avec la phrase du moteur (`raisonIndisponible`, la même
 * que le serveur renverrait) — le serveur refuse de toute façon.
 */
export function CircuitFinanceActions({
  demandeId,
  apresRejetDG,
  afficherRejet,
  raisonSoumettre,
  raisonRejeter,
  raisonResoumettre,
  soumissionParLignes = false,
}: {
  demandeId: string;
  /** Étape « Rejet DG » : actions de retour (resoumettre, renvoyer au demandeur). */
  apresRejetDG: boolean;
  /** « Rejeter la demande » n'est proposé ici que pour une demande à lignes (sans ligne : dans `ValidationActions`). */
  afficherRejet: boolean;
  raisonSoumettre: string | null;
  raisonRejeter: string | null;
  raisonResoumettre: string | null;
  /** Soumission au DG ligne par ligne (2026-10-10) : elle se fait depuis le tableau des lignes, pas de bouton ici. */
  soumissionParLignes?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [rejetOuvert, setRejetOuvert] = useState(false);
  const [motif, setMotif] = useState("");

  function lancer(appel: () => Promise<{ status: string; message?: string }>) {
    startTransition(async () => {
      const r = await appel();
      if (r.status === "success") {
        toast.success(r.message ?? "Enregistré.");
        setRejetOuvert(false);
        setMotif("");
      } else {
        toast.error(r.message ?? "Action refusée.");
      }
    });
  }

  const motifValide = motif.trim().length >= MOTIF_MIN;
  const libelleRejet = apresRejetDG ? "Rejeter vers le collaborateur" : "Rejeter la demande";
  // Une seule phrase : celle du bouton principal, sinon celle du rejet (souvent la même étape d'attente).
  const raison =
    (apresRejetDG ? raisonResoumettre : soumissionParLignes ? null : raisonSoumettre) ??
    (afficherRejet || apresRejetDG ? raisonRejeter : null);

  return (
    <section aria-label="Décision de la Finance" className="space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-elevated sm:p-6">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {apresRejetDG ? "Après le rejet du DG" : "Circuit de validation"}
      </h2>
      <div className="flex flex-wrap gap-2">
        {apresRejetDG ? (
          <Button
            type="button"
            disabled={!!raisonResoumettre || isPending}
            loading={isPending && !rejetOuvert}
            onClick={() => lancer(() => resoumettreAuDGAction(demandeId))}
          >
            Resoumettre au DG
          </Button>
        ) : soumissionParLignes ? null : (
          <Button
            type="button"
            variant="secondary"
            disabled={!!raisonSoumettre || isPending}
            loading={isPending && !rejetOuvert}
            onClick={() => lancer(() => soumettreAuDGAction(demandeId))}
          >
            Soumettre au DG
          </Button>
        )}
        {afficherRejet || apresRejetDG ? (
          <Button
            type="button"
            variant="danger"
            disabled={!!raisonRejeter || isPending}
            onClick={() => setRejetOuvert((v) => !v)}
          >
            {libelleRejet}
          </Button>
        ) : null}
      </div>

      {rejetOuvert && !raisonRejeter ? (
        <div className="space-y-2">
          <Textarea
            label="Motif du rejet (transmis au demandeur)"
            required
            rows={3}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            error={motif.length > 0 && !motifValide ? `${MOTIF_MIN} caractères minimum.` : undefined}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="danger"
              disabled={!motifValide || isPending}
              loading={isPending}
              onClick={() => lancer(() => rejeterDemandeAction(demandeId, motif))}
            >
              Confirmer le rejet
            </Button>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => setRejetOuvert(false)}>
              Annuler
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            La demande retourne au demandeur, qui pourra la corriger et la resoumettre, ou l&apos;abandonner.
          </p>
        </div>
      ) : null}

      {raison ? <p className="text-xs text-muted-foreground">{raison}</p> : null}
    </section>
  );
}

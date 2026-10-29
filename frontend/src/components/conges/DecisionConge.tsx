"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button, Textarea } from "@/components/ui";
import { frDate } from "@/lib/conges/format";
import type { ActionsPossiblesConge, ActionState } from "backend";
import {
  annulerCongeAction,
  approuverCongeAction,
  demanderModificationCongeAction,
  rejeterCongeAction,
} from "@/app/(dashboard)/conges/actions";

type ModeDecision = "rejeter" | "modifier" | "annuler" | null;

function formaterJoursProteges(jours: readonly string[]): string {
  if (jours.length > 10) {
    return `du ${frDate(jours[0])} au ${frDate(jours[jours.length - 1])}, ${jours.length} jours`;
  }
  return jours.map(frDate).join(", ");
}

interface DecisionCongeProps {
  demandeId: string;
  actions: ActionsPossiblesConge;
  estEtapeRH: boolean;
  joursPassesProteges: string[];
}

export function DecisionConge({
  demandeId,
  actions,
  estEtapeRH,
  joursPassesProteges,
}: DecisionCongeProps) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const [mode, setMode] = useState<ModeDecision>(null);
  const [motifRejet, setMotifRejet] = useState("");
  const [motifModification, setMotifModification] = useState("");
  const [motifAnnulation, setMotifAnnulation] = useState("");
  const [observationRH, setObservationRH] = useState("");
  const [compterJoursPasses, setCompterJoursPasses] = useState(false);

  function executer(action: () => Promise<ActionState>) {
    demarrer(async () => {
      const resultat = await action();
      if (resultat.status === "success") {
        toast.success(resultat.message ?? "La demande a été mise à jour.");
        setMode(null);
        router.refresh();
      } else if (resultat.status === "error") {
        toast.error(resultat.message);
      }
    });
  }

  function observationOptionnelle(): string | undefined {
    const valeur = observationRH.trim();
    return valeur || undefined;
  }

  function actionDesactivee(message: string | null) {
    return enCours || message !== null;
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-surface p-4 shadow-elevated sm:p-6">
      <div>
        <h2 className="text-lg font-bold text-foreground">Actions</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Les actions indisponibles restent visibles avec la raison communiquée par le circuit.
        </p>
      </div>

      {estEtapeRH ? (
        <Textarea
          label="Observation RH (facultative)"
          rows={2}
          maxLength={500}
          value={observationRH}
          onChange={(event) => setObservationRH(event.target.value)}
          disabled={enCours || actions.approuver !== null && actions.rejeter !== null && actions.demanderModification !== null}
          hint="Au maximum 500 caractères."
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Button
            type="button"
            className="w-full"
            disabled={actionDesactivee(actions.approuver)}
            title={actions.approuver ?? undefined}
            onClick={() =>
              executer(() => approuverCongeAction(demandeId, estEtapeRH ? observationOptionnelle() : undefined))
            }
          >
            Valider
          </Button>
          {actions.approuver ? <p className="text-sm text-muted-foreground">{actions.approuver}</p> : null}
        </div>

        <div className="space-y-2">
          <Button
            type="button"
            variant="danger"
            className="w-full"
            disabled={actionDesactivee(actions.rejeter)}
            title={actions.rejeter ?? undefined}
            onClick={() => setMode(mode === "rejeter" ? null : "rejeter")}
          >
            Rejeter
          </Button>
          {actions.rejeter ? <p className="text-sm text-muted-foreground">{actions.rejeter}</p> : null}
        </div>

        <div className="space-y-2">
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={actionDesactivee(actions.demanderModification)}
            title={actions.demanderModification ?? undefined}
            onClick={() => setMode(mode === "modifier" ? null : "modifier")}
          >
            Demander une modification
          </Button>
          {actions.demanderModification ? (
            <p className="text-sm text-muted-foreground">{actions.demanderModification}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={actionDesactivee(actions.annuler)}
            title={actions.annuler ?? undefined}
            onClick={() => setMode(mode === "annuler" ? null : "annuler")}
          >
            Annuler
          </Button>
          {actions.annuler ? <p className="text-sm text-muted-foreground">{actions.annuler}</p> : null}
        </div>
      </div>

      {mode === "rejeter" && !actions.rejeter ? (
        <div className="space-y-3 rounded-xl border border-danger-border bg-danger-bg p-4">
          <Textarea
            label="Motif du rejet"
            required
            rows={3}
            maxLength={500}
            value={motifRejet}
            onChange={(event) => setMotifRejet(event.target.value)}
          />
          {joursPassesProteges.length > 0 ? (
            <label className="flex items-start gap-3 text-sm text-foreground">
              <input
                type="checkbox"
                checked={compterJoursPasses}
                onChange={(event) => setCompterJoursPasses(event.target.checked)}
                className="mt-1 size-4 accent-primary"
              />
              <span>
                Compter les jours déjà passés comme absences
                <span className="mt-1 block text-xs text-muted-foreground">
                  Jours protégés : {formaterJoursProteges(joursPassesProteges)}
                </span>
              </span>
            </label>
          ) : null}
          <Button
            type="button"
            variant="danger"
            loading={enCours}
            disabled={enCours || motifRejet.trim().length < 3}
            onClick={() =>
              executer(() =>
                rejeterCongeAction(
                  demandeId,
                  motifRejet,
                  compterJoursPasses,
                  estEtapeRH ? observationOptionnelle() : undefined
                )
              )
            }
          >
            Confirmer le rejet
          </Button>
        </div>
      ) : null}

      {mode === "modifier" && !actions.demanderModification ? (
        <div className="space-y-3 rounded-xl border border-border bg-muted p-4">
          <Textarea
            label="Modification demandée"
            required
            rows={3}
            maxLength={500}
            value={motifModification}
            onChange={(event) => setMotifModification(event.target.value)}
          />
          <Button
            type="button"
            variant="primary"
            loading={enCours}
            disabled={enCours || motifModification.trim().length < 3}
            onClick={() =>
              executer(() =>
                demanderModificationCongeAction(
                  demandeId,
                  motifModification,
                  estEtapeRH ? observationOptionnelle() : undefined
                )
              )
            }
          >
            Envoyer la demande de modification
          </Button>
        </div>
      ) : null}

      {mode === "annuler" && !actions.annuler ? (
        <div className="space-y-3 rounded-xl border border-border bg-muted p-4">
          <Textarea
            label="Motif de l’annulation"
            required
            rows={3}
            maxLength={500}
            value={motifAnnulation}
            onChange={(event) => setMotifAnnulation(event.target.value)}
          />
          <Button
            type="button"
            variant="danger"
            loading={enCours}
            disabled={enCours || motifAnnulation.trim().length < 3}
            onClick={() => executer(() => annulerCongeAction(demandeId, motifAnnulation))}
          >
            Confirmer l’annulation
          </Button>
        </div>
      ) : null}
    </section>
  );
}

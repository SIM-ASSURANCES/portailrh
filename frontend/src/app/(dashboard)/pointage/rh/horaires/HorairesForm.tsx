"use client";

import { useActionState } from "react";
import { updateHorairesAction } from "./actions";
import { Button, Input } from "@/components/ui";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import { IDLE_ACTION_STATE } from "backend/client";
import type { ParametrageHoraire } from "backend";

export function HorairesForm({ config }: { config: ParametrageHoraire | null }) {
  const [state, formAction, isPending] = useActionState(updateHorairesAction, IDLE_ACTION_STATE);
  useActionFeedback(state);

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  // Si on n'a pas de config (cas rare en théorie), on initialise à vide
  const defMatinDeb = config?.heureDebutMatin || "";
  const defMatinFin = config?.heureFinMatin || "";
  const defApremDeb = config?.heureDebutApresMidi || "";
  const defApremFin = config?.heureFinApresMidi || "";
  const defDelai = config?.delaiAlerteOubliDepartMinutes ?? 30;
  const defTolerance = config?.toleranceRetardMinutes ?? 15;
  const defDelaiJustification = config?.delaiDemandeJustificationMinutes ?? 15;
  const defIntervalleRelance = config?.intervalleRelanceJustificationMinutes ?? 30;
  const defNombreEnvois = config?.nombreMaxRelancesJustification ?? 3;

  return (
    <form action={formAction} className="space-y-8 max-w-2xl bg-card p-6 rounded-lg border shadow-sm">
      <div className="space-y-4">
        <h3 className="text-lg font-medium border-b pb-2">Matinée</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Heure de début (Matin)"
            name="heureDebutMatin"
            type="time"
            defaultValue={defMatinDeb}
            required
            error={fieldErrors?.heureDebutMatin}
          />
          <Input
            label="Heure de fin (Matin)"
            name="heureFinMatin"
            type="time"
            defaultValue={defMatinFin}
            required
            error={fieldErrors?.heureFinMatin}
          />
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-medium border-b pb-2">Après-midi</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Heure de début (Après-midi)"
            name="heureDebutApresMidi"
            type="time"
            defaultValue={defApremDeb}
            required
            error={fieldErrors?.heureDebutApresMidi}
          />
          <Input
            label="Heure de fin (Après-midi)"
            name="heureFinApresMidi"
            type="time"
            defaultValue={defApremFin}
            required
            error={fieldErrors?.heureFinApresMidi}
          />
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-medium border-b pb-2">Tolérance de retard</h3>
        <p className="text-xs text-muted-foreground">
          Une arrivée jusqu&apos;à l&apos;heure de début du matin plus cette tolérance n&apos;est pas un retard. Au-delà,
          le retard est compté depuis la fin de la tolérance (exemple : début 07:45, tolérance 15 min, arrivée à 08:10 =
          10 min de retard ; arrivée à 07:58 ou 08:00 = à l&apos;heure).
        </p>
        <div className="max-w-xs">
          <Input
            label="Tolérance (en minutes)"
            name="toleranceRetardMinutes"
            type="number"
            min={0}
            max={120}
            defaultValue={defTolerance}
            required
            error={fieldErrors?.toleranceRetardMinutes}
          />
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-medium border-b pb-2">Justification des retards et départs anticipés</h3>
        <p className="text-xs text-muted-foreground">
          Le pointage est enregistré sans motif. Après le délai ci-dessous, le collaborateur reçoit un lien pour
          justifier (premier envoi : email, push et notification interne ; envois suivants : push et notification
          interne) et son responsable est prévenu. Sans motif à la fin de la journée, la justification passe en « non
          justifiée » et le responsable en est averti.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Input
            label="Délai avant la demande (min)"
            name="delaiDemandeJustificationMinutes"
            type="number"
            min={0}
            max={240}
            defaultValue={defDelaiJustification}
            required
            error={fieldErrors?.delaiDemandeJustificationMinutes}
          />
          <Input
            label="Intervalle entre relances (min)"
            name="intervalleRelanceJustificationMinutes"
            type="number"
            min={5}
            max={480}
            defaultValue={defIntervalleRelance}
            required
            error={fieldErrors?.intervalleRelanceJustificationMinutes}
          />
          <Input
            label="Nombre total d'envois"
            name="nombreMaxRelancesJustification"
            type="number"
            min={1}
            max={10}
            defaultValue={defNombreEnvois}
            required
            error={fieldErrors?.nombreMaxRelancesJustification}
          />
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-medium border-b pb-2">Alerte d&apos;oubli de départ</h3>
        <p className="text-xs text-muted-foreground">
          Délai d&apos;attente après l&apos;heure de fin de journée avant d&apos;envoyer automatiquement une alerte push, email et interne au collaborateur et aux RH.
        </p>
        <div className="max-w-xs">
          <Input
            label="Délai d'attente (en minutes)"
            name="delaiAlerteOubliDepartMinutes"
            type="number"
            min={0}
            max={360}
            defaultValue={defDelai}
            required
            error={fieldErrors?.delaiAlerteOubliDepartMinutes}
          />
        </div>
      </div>

      <div className="pt-4 border-t flex justify-end">
        <Button type="submit" loading={isPending}>
          Enregistrer les horaires
        </Button>
      </div>
    </form>
  );
}

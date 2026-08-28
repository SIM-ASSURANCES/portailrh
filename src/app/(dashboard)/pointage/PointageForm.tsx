"use client";

import { useActionState } from "react";
import { Badge, Button, Select, Textarea } from "@/components/ui";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import { IDLE_ACTION_STATE, type ActionState } from "@/lib/validation";
import type { ParametrageHoraire, Pointage } from "@/generated/prisma/client";
import { Icon } from "@/components/icons";
import { enregistrerPointageAction, type PointageSuccessData } from "./actions";
import type { PointageDevice } from "@/lib/pointage-utils";

interface PointageFormProps {
  config: ParametrageHoraire;
  todayPointages: Pointage[];
  isQrSource: boolean;
  device: PointageDevice;
}

export function PointageForm({ config, todayPointages, isQrSource, device }: PointageFormProps) {
  const [state, formAction, isPending] = useActionState<ActionState<PointageSuccessData>, FormData>(
    enregistrerPointageAction,
    IDLE_ACTION_STATE
  );
  useActionFeedback(state);
  const hasArrival = todayPointages.some((pointage) => pointage.type === "ARRIVEE");
  const hasDeparture = todayPointages.some((pointage) => pointage.type === "DEPART");
  const isComplete = hasArrival && hasDeparture;
  const successData = state.status === "success" ? state.data : undefined;
  const recordedAt = successData?.recordedAt
    ? new Date(successData.recordedAt).toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <form action={formAction} className="space-y-5">
      {isQrSource ? (
        <div className="flex items-center gap-3 rounded-md bg-primary p-4 text-primary-foreground shadow-sm">
          <span className="grid size-11 shrink-0 place-items-center rounded-md bg-sim-blue-light/25">
            <Icon name="qr-code" className="size-6" />
          </span>
          <div>
            <p className="font-bold">Pointage par QR code</p>
            <p className="mt-0.5 text-sm text-primary-foreground/80">Votre présence sera enregistrée maintenant.</p>
          </div>
        </div>
      ) : null}

      <div className="rounded-md border border-border bg-surface p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Aujourd&apos;hui</p>
            <h2 className="mt-1 text-xl font-bold text-foreground">Votre présence</h2>
          </div>
          <Badge variant={isComplete ? "success" : "info"}>
            {isComplete ? "Journée complète" : "En cours"}
          </Badge>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-md bg-muted p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Arrivée</p>
            <p className="mt-1 text-lg font-bold text-foreground">
              {todayPointages.find((pointage) => pointage.type === "ARRIVEE")?.heure.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) ?? "--:--"}
            </p>
          </div>
          <div className="rounded-md bg-muted p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Départ</p>
            <p className="mt-1 text-lg font-bold text-foreground">
              {todayPointages.find((pointage) => pointage.type === "DEPART")?.heure.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) ?? "--:--"}
            </p>
          </div>
        </div>
      </div>

      {recordedAt ? (
        <div className="rounded-md border border-success-border bg-success-bg p-4 text-success">
          <p className="font-bold">Pointage enregistré</p>
          <p className="mt-1 text-sm">Enregistré le {recordedAt} par le serveur.</p>
          {successData?.minutesRetard ? <p className="mt-1 text-sm">Retard constaté : {successData.minutesRetard} minute(s).</p> : null}
        </div>
      ) : null}

      {!isComplete ? (
        <div className="space-y-5 rounded-md border border-border bg-surface p-5 shadow-sm">
          <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            Horaires de référence : {config.heureDebutMatin}–{config.heureFinMatin} et {config.heureDebutApresMidi}–{config.heureFinApresMidi}
          </div>
          <Select name="type" label="Type de pointage" options={[
            { value: "ARRIVEE", label: "Arrivée" },
            { value: "DEPART", label: "Départ" },
          ]} defaultValue={hasArrival ? "DEPART" : "ARRIVEE"} />
          <input type="hidden" name="source" value={device === "TELEPHONE" ? "QR_CODE" : "ORDINATEUR"} />
          <Textarea name="motif" label="Motif du retard" hint="Obligatoire uniquement si votre arrivée est en retard." error={state.status === "error" ? state.fieldErrors?.motif : undefined} rows={3} />
          <Button type="submit" loading={isPending} className="min-h-12 w-full text-base">
            {isQrSource ? "Confirmer mon pointage" : "Enregistrer mon pointage"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
"use client";

import { useActionState, useState } from "react";

import { Button, Input, Select } from "@/components/ui";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import { IDLE_ACTION_STATE } from "backend/client";

import { createUserAction } from "./actions";
import type { ServiceAvecResponsable } from "./UserResponsableToggle";

export function UserCreateForm({
  roles,
  services,
}: {
  roles: { id: string; name: string }[];
  services: ServiceAvecResponsable[];
}) {
  const [state, formAction, isPending] = useActionState(createUserAction, IDLE_ACTION_STATE);
  useActionFeedback(state);
  const [serviceId, setServiceId] = useState("");
  const [responsable, setResponsable] = useState(false);
  const [confirme, setConfirme] = useState(false);
  // Responsable en place du service choisi : sa présence exige une confirmation qui le nomme (revérifiée côté serveur).
  const enPlace = services.find((s) => s.id === serviceId)?.responsableNom ?? null;
  const serviceNom = services.find((s) => s.id === serviceId)?.name ?? "";

  return (
    <form
      action={formAction}
      className="grid grid-cols-1 gap-4 rounded-md border border-border p-4 sm:grid-cols-2"
    >
      <Input
        name="fullName"
        label="Nom complet"
        required
        error={state.status === "error" ? state.fieldErrors?.fullName : undefined}
      />
      <Input
        name="email"
        label="Email"
        type="email"
        required
        error={state.status === "error" ? state.fieldErrors?.email : undefined}
      />
      <Input
        name="password"
        label="Mot de passe"
        type="password"
        required
        hint="8 caractères minimum"
        error={state.status === "error" ? state.fieldErrors?.password : undefined}
      />
      <Select
        name="roleId"
        label="Rôle"
        options={roles.map((r) => ({ value: r.id, label: r.name }))}
        required
        error={state.status === "error" ? state.fieldErrors?.roleId : undefined}
      />
      <Select
        name="serviceId"
        label="Service"
        required
        placeholder="Choisir un service…"
        options={services.map((s) => ({ value: s.id, label: s.name }))}
        value={serviceId}
        onChange={(e) => {
          setServiceId(e.target.value);
          setConfirme(false);
        }}
        error={state.status === "error" ? state.fieldErrors?.serviceId : undefined}
      />
      <div className="space-y-2 sm:col-span-2">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            name="responsableDuService"
            checked={responsable}
            disabled={!serviceId}
            onChange={(e) => {
              setResponsable(e.target.checked);
              setConfirme(false);
            }}
          />
          Responsable de ce service
        </label>
        {responsable && enPlace ? (
          <label className="flex items-start gap-2 rounded-md bg-warning-bg p-2 text-sm text-warning">
            <input type="checkbox" name="confirmerRemplacement" checked={confirme} onChange={(e) => setConfirme(e.target.checked)} />
            <span>
              {enPlace} est actuellement responsable du service « {serviceNom} ». Je confirme le remplacement : {enPlace} reste
              membre de son service mais n&apos;en est plus responsable.
            </span>
          </label>
        ) : null}
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" loading={isPending} disabled={responsable && !!enPlace && !confirme}>
          Créer l&apos;utilisateur
        </Button>
      </div>
    </form>
  );
}

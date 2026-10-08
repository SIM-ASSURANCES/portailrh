"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui";

import { designerResponsableDeSonServiceAction } from "./actions";

export interface ServiceAvecResponsable {
  id: string;
  name: string;
  responsableId: string | null;
  responsableNom: string | null;
}

/**
 * Case « Responsable de ce service » d'un compte (liste des utilisateurs) : le désigne responsable du service dont il
 * est membre. Si un autre responsable existe, une confirmation le nomme (il reste membre de son service, il n'en est
 * plus responsable). Décocher n'est pas possible : on remplace un responsable, on ne le retire jamais (écran Services).
 */
export function UserResponsableToggle({ userId, service }: { userId: string; service: ServiceAvecResponsable | null }) {
  const [aConfirmer, setAConfirmer] = useState(false);
  const [isPending, startTransition] = useTransition();
  if (!service) return null;
  const estResponsable = service.responsableId === userId;

  function designer(confirme: boolean) {
    startTransition(async () => {
      const r = await designerResponsableDeSonServiceAction(userId, confirme);
      if (r.status === "error") toast.error(r.message);
      else if (r.status === "success" && r.message) toast.success(r.message);
      setAConfirmer(false);
    });
  }

  return (
    <div className="space-y-1">
      <label
        className="flex items-center gap-2 text-xs text-foreground"
        title={estResponsable ? "Pour le retirer, désignez un autre responsable (Administration › Services)." : undefined}
      >
        <input
          type="checkbox"
          checked={estResponsable || aConfirmer}
          disabled={estResponsable || isPending}
          onChange={(e) => {
            if (!e.target.checked) return setAConfirmer(false);
            if (service.responsableId && service.responsableId !== userId) setAConfirmer(true);
            else designer(false);
          }}
        />
        Responsable de ce service
      </label>
      {aConfirmer ? (
        <div className="space-y-1.5 rounded-md bg-warning-bg p-2 text-xs text-warning">
          <p>
            {service.responsableNom} est actuellement responsable du service « {service.name} ». Le remplacer ? Il reste
            membre de son service mais n&apos;en est plus responsable.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" loading={isPending} onClick={() => designer(true)}>
              Confirmer
            </Button>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => setAConfirmer(false)}>
              Annuler
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Select } from "@/components/ui";

import { definirResponsableServiceAction } from "./actions";

/**
 * Responsable d'un service, modifiable en ligne (action immédiate au changement, comme `UserServiceSelect`). Le
 * responsable est obligatoire : on peut le remplacer, jamais le retirer. Valeur initialisée une seule fois (même
 * raison que `UserServiceSelect` : un rafraîchissement global sans rapport ne doit pas faire revenir l'affichage en
 * arrière), corrigée seulement par le retour arrière en cas d'échec réel de l'action.
 */
export function ServiceResponsableSelect({
  serviceId,
  serviceNom,
  currentResponsableId,
  utilisateurs,
}: {
  serviceId: string;
  serviceNom: string;
  currentResponsableId: string | null;
  utilisateurs: { id: string; label: string }[];
}) {
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState(currentResponsableId ?? "");

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const precedent = value;
    const nouveau = e.target.value;
    if (!nouveau) return;
    setValue(nouveau);
    startTransition(async () => {
      const res = await definirResponsableServiceAction(serviceId, nouveau);
      if (res.status === "error") {
        toast.error(res.message);
        setValue(precedent);
      } else if (res.status === "success" && res.message) {
        toast.success(res.message);
      }
    });
  };

  return (
    <Select
      name={`responsable-${serviceId}`}
      aria-label={`Responsable du service ${serviceNom}`}
      placeholder="À désigner…"
      options={utilisateurs.map((u) => ({ value: u.id, label: u.label }))}
      value={value}
      onChange={handleChange}
      disabled={isPending}
      className="max-w-[300px]"
    />
  );
}

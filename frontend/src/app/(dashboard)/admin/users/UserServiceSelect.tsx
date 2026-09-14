"use client";

import { useTransition, useState } from "react";
import { Select } from "@/components/ui";
import { updateUserServiceAction } from "./actions";
import { toast } from "sonner";

/**
 * Select inline pour le service d'un utilisateur, dans le tableau des
 * comptes — même principe d'action immédiate au changement que
 * `UserRoleSelect`/`UserActiveToggle`, pas de bouton "Enregistrer" séparé.
 *
 * Contrôlé (`value`), initialisé UNE SEULE FOIS depuis `currentServiceId`
 * (`useState`, jamais un `useEffect` qui le resynchroniserait à chaque
 * changement du prop) — même principe que `UserRoleSelect.tsx` :
 * `/admin/users` reçoit un `router.refresh()` de deux sources
 * indépendantes après toute mutation n'importe où dans l'app (le
 * rafraîchissement automatique de CETTE Server Action, et le SSE global
 * `publishDataChanged()`, voir CLAUDE.md "Rafraîchissement en temps réel").
 * Un `useEffect` sur `currentServiceId` resynchronisait la sélection à
 * CHAQUE nouveau rendu du tableau, y compris ceux déclenchés par l'action
 * d'un AUTRE utilisateur sur une AUTRE ligne (le SSE est global, non scopé
 * à la ligne modifiée) : si un tel rafraîchissement, émis par une mutation
 * sans rapport, livrait une réponse retardée reflétant un état antérieur à
 * l'écriture en cours sur CETTE ligne (course réseau plausible sous
 * activité concurrente réelle), la sélection revenait visuellement à
 * l'ancienne valeur alors que l'écriture en base avait bel et bien réussi.
 * L'autorité du "bon" affichage reste désormais uniquement : la valeur
 * choisie par CET utilisateur (optimiste), corrigée UNIQUEMENT par le
 * chemin de rollback explicite ci-dessous en cas d'échec réel de CETTE
 * action précise — jamais par un effet de bord d'un rafraîchissement
 * global sans rapport.
 */
export function UserServiceSelect({
  userId,
  currentServiceId,
  services,
}: {
  userId: string;
  currentServiceId: string | null;
  services: { id: string; name: string }[];
}) {
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState(currentServiceId || "");

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const precedent = value;
    const newServiceId = e.target.value === "" ? null : e.target.value;
    setValue(e.target.value);

    startTransition(async () => {
      const res = await updateUserServiceAction(userId, newServiceId);
      if (res.status === "error") {
        toast.error(res.message);
        setValue(precedent); // Rollback UI vers la valeur précédente réelle
      } else if (res.status === "success" && res.message) {
        toast.success(res.message);
      }

    });
  };

  return (
    <Select
      name={`service-${userId}`}
      options={[
        { value: "", label: "Aucun service" },
        ...services.map((s) => ({ value: s.id, label: s.name })),
      ]}
      value={value}
      onChange={handleChange}
      disabled={isPending}
      className="max-w-[180px]"
    />
  );
}

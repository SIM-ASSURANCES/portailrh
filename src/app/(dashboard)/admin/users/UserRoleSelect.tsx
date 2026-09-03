"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Select } from "@/components/ui";

import { modifierRoleUtilisateurAction } from "./actions";

/**
 * Select inline pour le rôle d'un utilisateur, dans le tableau des comptes
 * — même principe d'action immédiate au changement que `PermissionToggle`
 * (roles/PermissionToggle.tsx) et `UserActiveToggle`, pas de bouton
 * "Enregistrer" séparé.
 *
 * Contrôlé (`value`, pas `defaultValue`) délibérément : en cas d'échec côté
 * serveur, la sélection visuelle doit revenir à l'ancien rôle plutôt que de
 * rester sur le choix qui n'a en réalité pas été appliqué en base — un
 * select non contrôlé ne le permettrait pas (voir `Select.tsx` : la prop
 * `value` désactive son `defaultValue` interne, aucun conflit React).
 */
export function UserRoleSelect({
  userId,
  roleId,
  roles,
}: {
  userId: string;
  roleId: string;
  roles: { id: string; name: string }[];
}) {
  const [selected, setSelected] = useState(roleId);
  const [isPending, startTransition] = useTransition();

  function handleChange(nouveauRoleId: string) {
    const precedent = selected;
    setSelected(nouveauRoleId);
    startTransition(async () => {
      const result = await modifierRoleUtilisateurAction(userId, nouveauRoleId);
      if (result.status === "success") {
        toast.success(result.message);
      } else {
        setSelected(precedent);
        toast.error(result.message);
      }
    });
  }

  return (
    <Select
      aria-label="Rôle"
      value={selected}
      disabled={isPending}
      onChange={(e) => handleChange(e.target.value)}
      options={roles.map((r) => ({ value: r.id, label: r.name }))}
    />
  );
}

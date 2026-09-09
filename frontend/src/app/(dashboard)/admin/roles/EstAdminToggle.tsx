"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { toggleRoleEstAdminAction } from "./actions";

/**
 * Case à cocher "Accès à l'administration" (`Role.estAdmin`) — voir
 * CLAUDE.md "estAdmin remplace le nom de rôle". Même pattern que
 * `PermissionToggle.tsx` (case native, `useTransition`, toast), mais pilote
 * `Role.estAdmin` au lieu d'une ligne `RolePermission` : une notion
 * distincte (accès au Socle), pas une permission de module.
 */
export function EstAdminToggle({
  roleId,
  defaultChecked,
}: {
  roleId: string;
  defaultChecked: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  function handleChange(checked: boolean) {
    startTransition(async () => {
      const result = await toggleRoleEstAdminAction(roleId, checked);
      if (result.status === "success") {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <label className="flex items-center gap-2 text-sm font-medium text-foreground">
      <input
        type="checkbox"
        defaultChecked={defaultChecked}
        disabled={isPending}
        onChange={(e) => handleChange(e.target.checked)}
        className="h-4 w-4 rounded border-border accent-primary"
      />
      Accès à l&apos;administration
    </label>
  );
}

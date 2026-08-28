"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { toggleRolePermissionAction } from "./actions";

export function PermissionToggle({
  roleId,
  permissionId,
  label,
  defaultChecked,
}: {
  roleId: string;
  permissionId: string;
  label: string;
  defaultChecked: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  function handleChange(checked: boolean) {
    startTransition(async () => {
      const result = await toggleRolePermissionAction(roleId, permissionId, checked);
      if (result.status === "success") {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <label className="flex items-center gap-2 text-sm text-foreground">
      <input
        type="checkbox"
        defaultChecked={defaultChecked}
        disabled={isPending}
        onChange={(e) => handleChange(e.target.checked)}
        className="h-4 w-4 rounded border-border accent-primary"
      />
      {label}
    </label>
  );
}

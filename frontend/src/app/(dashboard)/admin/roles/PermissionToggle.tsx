"use client";

import { useOptimistic, useTransition } from "react";
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
  const [optimisticChecked, setOptimisticChecked] = useOptimistic(
    defaultChecked,
    (_current, next: boolean) => next
  );
  const [isPending, startTransition] = useTransition();

  function handleChange(nextChecked: boolean) {
    startTransition(async () => {
      setOptimisticChecked(nextChecked);
      const result = await toggleRolePermissionAction(roleId, permissionId, nextChecked);
      if (result.status === "success") {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <label className="flex w-full cursor-pointer items-center gap-2 py-0.5 text-sm text-foreground select-none">
      <input
        type="checkbox"
        checked={optimisticChecked}
        disabled={isPending}
        onChange={(e) => handleChange(e.target.checked)}
        className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary disabled:opacity-50"
      />
      <span>{label}</span>
    </label>
  );
}

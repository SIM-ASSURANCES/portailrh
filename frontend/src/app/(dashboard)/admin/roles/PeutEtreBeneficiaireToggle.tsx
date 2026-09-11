"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { toggleRolePeutEtreBeneficiaireDelegationAction } from "./actions";

export function PeutEtreBeneficiaireToggle({
  roleId,
  defaultChecked,
}: {
  roleId: string;
  defaultChecked: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  function handleChange(checked: boolean) {
    startTransition(async () => {
      const result = await toggleRolePeutEtreBeneficiaireDelegationAction(roleId, checked);
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
      Éligible comme bénéficiaire de délégation
    </label>
  );
}

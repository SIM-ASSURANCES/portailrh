"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { toggleRolePeutRecevoirFeedbackAction } from "./actions";

export function PeutRecevoirFeedbackToggle({
  roleId,
  defaultChecked,
}: {
  roleId: string;
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
      const result = await toggleRolePeutRecevoirFeedbackAction(roleId, nextChecked);
      if (result.status === "success") {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <label className="flex w-full cursor-pointer items-center gap-2 text-sm text-foreground select-none">
      <input
        type="checkbox"
        checked={optimisticChecked}
        disabled={isPending}
        onChange={(e) => handleChange(e.target.checked)}
        className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary disabled:opacity-50"
      />
      <span>Éligible comme destinataire FeedbackApp</span>
    </label>
  );
}

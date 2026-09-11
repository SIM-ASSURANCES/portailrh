"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui";
import { revoquerDelegationAction } from "@/app/(dashboard)/delegations/actions";

export function RevoquerDelegationButton({ delegationId }: { delegationId: string }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await revoquerDelegationAction(delegationId);
      if (result.status === "success") {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <Button type="button" variant="danger" loading={isPending} onClick={handleClick}>
      Révoquer
    </Button>
  );
}

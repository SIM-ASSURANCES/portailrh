"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui";

import { toggleUserActiveAction } from "./actions";

export function UserActiveToggle({ userId, isActive }: { userId: string; isActive: boolean }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await toggleUserActiveAction(userId, !isActive);
      if (result.status === "success") {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <Button
      type="button"
      variant={isActive ? "danger" : "secondary"}
      loading={isPending}
      onClick={handleClick}
    >
      {isActive ? "Désactiver" : "Réactiver"}
    </Button>
  );
}

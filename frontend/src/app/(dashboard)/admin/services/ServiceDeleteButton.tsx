"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui";
import { deleteServiceAction } from "./actions";
import { toast } from "sonner";

export function ServiceDeleteButton({ id, disabled }: { id: string, disabled: boolean }) {
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    if (!confirm("Voulez-vous vraiment supprimer ce service ?")) return;
    
    startTransition(async () => {
      const res = await deleteServiceAction(id);
      if (res.status === "error") {
        toast.error(res.message);
      } else if (res.status === "success") {
        toast.success(res.message);
      }
    });
  };

  return (
    <Button
      variant="danger"
      disabled={disabled || isPending}
      loading={isPending}
      onClick={handleDelete}
      title={disabled ? "Impossible de supprimer un service qui a des collaborateurs" : "Supprimer"}
    >
      Supprimer
    </Button>
  );
}

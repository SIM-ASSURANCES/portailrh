"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button, Textarea } from "@/components/ui";
import { enregistrerPointageAction } from "./actions";

export function PointageForm({ type, source }: { type: "ARRIVEE" | "DEPART", source: "QR_CODE" | "ORDINATEUR" }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const motif = formData.get("motif") as string;

    startTransition(async () => {
      const result = await enregistrerPointageAction({ source, type, motif });
      if (result.status === "success") {
        toast.success("Pointage enregistré avec succès");
        router.refresh();
      } else if (result.status === "error") {
        toast.error(result.message || "Erreur de pointage");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Textarea
        name="motif"
        label="Motif (obligatoire)"
        required
        rows={4}
        placeholder="Veuillez renseigner votre justification détaillée..."
      />
      <Button type="submit" loading={isPending} className="w-full">
        Valider mon {type === "ARRIVEE" ? "arrivée" : "départ"}
      </Button>
    </form>
  );
}
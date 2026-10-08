"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Textarea } from "@/components/ui";

import { marquerSignalementTraiteAction } from "./actions";

/** « Marquer traité » avec commentaire facultatif (ouvert sur demande, même convention que les autres actions inline). */
export function MarquerTraiteButton({ signalementId }: { signalementId: string }) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [commentaire, setCommentaire] = useState("");
  const [enCours, startTransition] = useTransition();

  if (!ouvert) {
    return (
      <Button variant="secondary" type="button" onClick={() => setOuvert(true)}>
        Marquer traité
      </Button>
    );
  }

  function confirmer() {
    startTransition(async () => {
      const resultat = await marquerSignalementTraiteAction(signalementId, commentaire.trim() || undefined);
      if (resultat.status === "success") {
        toast.success(resultat.message);
        setOuvert(false);
        router.refresh();
      } else {
        toast.error(resultat.message);
      }
    });
  }

  return (
    <div className="w-64 max-w-full space-y-2">
      <Textarea
        label="Commentaire"
        hint="Facultatif."
        rows={2}
        maxLength={500}
        value={commentaire}
        onChange={(e) => setCommentaire(e.target.value)}
      />
      <div className="flex gap-2">
        <Button type="button" onClick={confirmer} loading={enCours}>
          Confirmer
        </Button>
        <Button variant="secondary" type="button" onClick={() => setOuvert(false)} disabled={enCours}>
          Annuler
        </Button>
      </div>
    </div>
  );
}

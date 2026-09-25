"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui";
import { PieceJointeUpload } from "@/components/tresorerie/PieceJointeUpload";

import { justifierDepenseApresReceptionAction } from "../retourActions";

/**
 * Sur une "dépense sans pièce formelle", ajoute a posteriori la pièce jointe manquante : la ligne
 * bascule sur "Dépense justifiée" (retour déjà réceptionné ou non, montant et caisse inchangés).
 */
export function JustifierApresReception({ depenseLigneId }: { depenseLigneId: string }) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [pj, setPj] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  if (!ouvert) {
    return (
      <button
        type="button"
        className="text-xs text-info underline-offset-4 hover:text-primary hover:underline"
        onClick={() => setOuvert(true)}
      >
        Ajouter une pièce jointe (justifier cette dépense)
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-2">
      <PieceJointeUpload label="Pièce jointe justificative" hint="PDF, JPG ou PNG — 10 Mo maximum. Obligatoire." onChange={(url) => setPj(url ?? undefined)} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          loading={isPending}
          disabled={!pj || isPending}
          onClick={() =>
            startTransition(async () => {
              const r = await justifierDepenseApresReceptionAction(depenseLigneId, pj!);
              if (r.status === "success") {
                toast.success(r.message);
                router.refresh();
              } else toast.error(r.message);
            })
          }
        >
          Justifier la dépense
        </Button>
        <Button type="button" variant="secondary" disabled={isPending} onClick={() => setOuvert(false)}>
          Annuler
        </Button>
      </div>
    </div>
  );
}

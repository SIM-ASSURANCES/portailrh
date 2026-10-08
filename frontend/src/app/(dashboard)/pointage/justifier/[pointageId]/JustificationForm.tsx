"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button, Textarea } from "@/components/ui";
import { soumettreJustificationAction } from "./actions";

const MOTIF_MIN = 3;
const MOTIF_MAX = 500;

/** Saisie du motif (3 à 500 caractères, revérifié côté serveur). */
export function JustificationForm({ pointageId, decideurLibelle }: { pointageId: string; decideurLibelle: string }) {
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const longueur = motif.trim().length;
  const tropCourt = longueur > 0 && longueur < MOTIF_MIN;

  const envoyer = () => {
    startTransition(async () => {
      const resultat = await soumettreJustificationAction(pointageId, motif);
      if (resultat.status === "success") {
        toast.success(resultat.message ?? "Justification envoyée.");
        setErreur(undefined);
        router.refresh();
      } else if (resultat.status === "error") {
        setErreur(resultat.fieldErrors?.motif);
        toast.error(resultat.message);
      }
    });
  };

  return (
    <div className="space-y-4">
      <Textarea
        label="Motif"
        name="motif"
        required
        rows={4}
        maxLength={MOTIF_MAX}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        placeholder="Ex. : embouteillage important sur le pont, rendez-vous médical…"
        hint={`Elle sera examinée par ${decideurLibelle}. ${MOTIF_MIN} à ${MOTIF_MAX} caractères.`}
        error={erreur ?? (tropCourt ? `${MOTIF_MIN} caractères minimum.` : undefined)}
      />
      <Button variant="primary" loading={isPending} disabled={longueur < MOTIF_MIN} onClick={envoyer}>
        Envoyer ma justification
      </Button>
    </div>
  );
}

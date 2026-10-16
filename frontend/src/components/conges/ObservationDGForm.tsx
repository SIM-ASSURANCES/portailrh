"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button, Textarea } from "@/components/ui";
import { OBSERVATION_MAX } from "backend/client";
import type { ActionState } from "backend";

/**
 * Observation du DG sur une demande : à tout moment, sans bloquer ni changer le statut. Le serveur revérifie tout (permission
 * du RÔLE, jamais sa propre demande, 500 caractères) ; ce composant n'est qu'un formulaire.
 */
export function ObservationDGForm({ demandeId, ajouter }: { demandeId: string; ajouter: (id: string, texte: string) => Promise<ActionState> }) {
  const [texte, setTexte] = useState("");
  const [enCours, demarrer] = useTransition();
  const router = useRouter();
  const longueur = texte.trim().length;

  return (
    <form
      className="space-y-3 rounded-lg border border-border bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        demarrer(async () => {
          const r = await ajouter(demandeId, texte);
          if (r.status === "success") {
            toast.success(r.message ?? "Observation ajoutée.");
            setTexte("");
            router.refresh();
          } else if (r.status === "error") {
            toast.error(r.message);
          }
        });
      }}
    >
      <Textarea
        id={`observation-dg-${demandeId}`}
        label="Ajouter une observation (DG)"
        rows={3}
        maxLength={OBSERVATION_MAX}
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        hint={`Un avis, pas une décision : le statut de la demande ne change pas. Le demandeur et la RH en sont informés. ${OBSERVATION_MAX} caractères au plus ; elle ne pourra plus être modifiée ni supprimée.`}
      />
      <Button type="submit" variant="secondary" loading={enCours} disabled={longueur === 0}>
        Ajouter l&apos;observation
      </Button>
    </form>
  );
}

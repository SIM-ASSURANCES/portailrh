"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button, Input, Textarea } from "@/components/ui";
import type { ActionState } from "backend";

import { approuverPermissionAction, marquerRetourPermissionAction } from "../actions";

const MOTIF_DEROGATION_MIN = 5;

function useExecuter() {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const executer = (appel: () => Promise<ActionState>, apres?: () => void) => {
    demarrer(async () => {
      const r = await appel();
      if (r.status === "success") {
        toast.success(r.message ?? "Enregistré.");
        apres?.();
        router.refresh();
      } else if (r.status === "error") {
        toast.error(r.message);
      }
    });
  };
  return { enCours, executer };
}

/**
 * Accord d'une permission quand le plafond mensuel est déjà atteint : la RH doit motiver la dérogation (5 caractères).
 * Le serveur revérifie tout (étape, acteur, plafond, motif) — ce composant n'est qu'un formulaire.
 */
export function DerogationPlafond({ demandeId, utilise, plafond }: { demandeId: string; utilise: number; plafond: number }) {
  const [motif, setMotif] = useState("");
  const { enCours, executer } = useExecuter();
  const longueur = motif.trim().length;

  return (
    <div className="space-y-3 rounded-lg border border-warning-border bg-warning-bg px-4 py-3">
      <p className="text-sm font-medium text-warning">
        Le plafond mensuel de ce type est atteint pour ce collaborateur ({utilise}/{plafond} déjà accordées ce mois-ci). Pour accorder quand même, motivez la
        dérogation.
      </p>
      <Textarea
        label="Motif de la dérogation"
        required
        rows={3}
        maxLength={500}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        error={longueur > 0 && longueur < MOTIF_DEROGATION_MIN ? `${MOTIF_DEROGATION_MIN} caractères minimum.` : undefined}
      />
      <Button variant="primary" loading={enCours} disabled={longueur < MOTIF_DEROGATION_MIN} onClick={() => executer(() => approuverPermissionAction(demandeId, motif), () => setMotif(""))}>
        Accorder avec dérogation
      </Button>
    </div>
  );
}

/** Marquage du retour réel : par le demandeur ou la RH, une fois le jour de la permission atteint. */
export function RetourReel({ demandeId, heureRetourPrevue }: { demandeId: string; heureRetourPrevue: string }) {
  const [heure, setHeure] = useState(heureRetourPrevue);
  const { enCours, executer } = useExecuter();

  return (
    <div className="space-y-3">
      <Input label="Heure de retour réelle" type="time" required value={heure} onChange={(e) => setHeure(e.target.value)} hint={`Retour prévu à ${heureRetourPrevue}.`} />
      <Button variant="primary" loading={enCours} disabled={!heure} onClick={() => executer(() => marquerRetourPermissionAction(demandeId, heure))}>
        Enregistrer le retour
      </Button>
    </div>
  );
}

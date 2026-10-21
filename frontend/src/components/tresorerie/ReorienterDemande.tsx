"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Select, Textarea } from "@/components/ui";
import { MOTIF_REORIENTATION_MIN } from "backend/client";

import { reorienterDemandeAction } from "@/app/(dashboard)/treso/circuit/actions";

/**
 * Lot K — « Réorienter vers un autre responsable » : le demandeur, ou la Finance, confie l'étape du responsable de service à un
 * autre responsable DISPONIBLE (compte actif, ni absent, ni demandeur, ni bénéficiaire). Affiché seulement tant que la demande
 * attend ce responsable. La liste vient du serveur (`contexteReorientationDemande`) et est revérifiée par l'action.
 * Aucune information budgétaire ici (le demandeur ne voit jamais les restes).
 */
export function ReorienterDemande({
  demandeId,
  responsableActuel,
  eligibles,
}: {
  demandeId: string;
  /** Décideur actuel de l'étape (nom), pour que l'utilisateur sache de qui on part. */
  responsableActuel: string | null;
  eligibles: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [cible, setCible] = useState("");
  const [motif, setMotif] = useState("");
  const [isPending, startTransition] = useTransition();
  const motifValide = motif.trim().length >= MOTIF_REORIENTATION_MIN;
  const aucun = eligibles.length === 0;

  function confirmer() {
    startTransition(async () => {
      const r = await reorienterDemandeAction(demandeId, cible, motif);
      if (r.status === "success") {
        toast.success(r.message);
        setOuvert(false);
        setMotif("");
        setCible("");
        router.refresh();
      } else {
        toast.error(r.message);
      }
    });
  }

  return (
    <section aria-label="Réorienter vers un autre responsable" data-reorienter className="space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-elevated sm:p-6">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Responsable de service absent ?</h2>
      <p className="text-sm text-foreground">
        La demande attend la validation de {responsableActuel ? <strong>{responsableActuel}</strong> : "son responsable de service"}. Si cette
        personne n&apos;est pas disponible, confiez cette étape à un autre responsable : le service du demandeur ne change pas.
      </p>
      <Button type="button" variant="secondary" data-reorienter-ouvrir disabled={aucun || isPending} onClick={() => setOuvert((v) => !v)}>
        Réorienter vers un autre responsable
      </Button>
      {aucun ? <p className="text-xs text-muted-foreground">Aucun autre responsable de service disponible pour le moment.</p> : null}

      {ouvert && !aucun ? (
        <div className="space-y-3" data-reorienter-formulaire>
          <Select
            label="Nouveau responsable"
            required
            placeholder="Choisir un responsable..."
            value={cible}
            onChange={(e) => setCible(e.target.value)}
            options={eligibles.map((c) => ({ value: c.id, label: c.label }))}
          />
          <Textarea
            label="Pourquoi réorienter ?"
            required
            rows={3}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            hint={`${MOTIF_REORIENTATION_MIN} caractères minimum. Le motif est conservé dans l'historique de la demande.`}
            error={motif.length > 0 && !motifValide ? `${MOTIF_REORIENTATION_MIN} caractères minimum.` : undefined}
          />
          <div className="flex flex-wrap gap-2">
            <Button signe type="button" disabled={!cible || !motifValide || isPending} loading={isPending} onClick={confirmer}>
              Confirmer la réorientation
            </Button>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => setOuvert(false)}>
              Annuler
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

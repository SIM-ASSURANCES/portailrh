"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button, Input, Textarea } from "@/components/ui";
import { PieceJointeUpload } from "@/components/tresorerie/PieceJointeUpload";

import {
  declarerRetourComplementaireAction,
  proposerRemboursementRetourAction,
  rejeterRemboursementRetourAction,
  validerRemboursementRetourAction,
} from "../retourActions";

const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

/**
 * Régularisation d'un retour RÉCEPTIONNÉ signalé avec un montant proposé (voir CLAUDE.md
 * "Correction d'un retour signalé") : propose l'action adaptée au sens de l'écart. Le retour
 * d'origine et son écriture de caisse ne sont jamais modifiés.
 */
export function RegularisationSignalement({
  retourId,
  montantRecu,
  montantPropose,
  peutAgir,
  remboursementEnAttente,
  regulariseDeja,
}: {
  retourId: string;
  montantRecu: number;
  montantPropose: number;
  /** Assistant Finance (`treso.receptionner_retour`). */
  peutAgir: boolean;
  remboursementEnAttente: boolean;
  /** Une régularisation de caisse (complément ou remboursement) existe déjà pour ce signalement. */
  regulariseDeja: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [montant, setMontant] = useState("");
  const [motif, setMotif] = useState("");
  const [pj, setPj] = useState<string | undefined>();
  const ecart = Math.round((montantPropose - montantRecu) * 100) / 100;

  if (ecart === 0) {
    return regulariseDeja ? (
      <p className="text-xs">
        Régularisation de caisse effectuée : il reste à <strong>corriger le détail des dépenses</strong> (formulaire ci-dessous) — le
        signalement sera alors marqué résolu.
      </p>
    ) : (
      <p className="text-xs">Le montant proposé est identique au montant déjà réceptionné : aucune régularisation de caisse.</p>
    );
  }
  if (!peutAgir) {
    return (
      <p className="text-xs">
        Régularisation ({ecart > 0 ? "retour complémentaire" : "remboursement"} de {fcfa(Math.abs(ecart))}) à traiter par
        l&apos;Assistant Finance.
      </p>
    );
  }

  if (ecart > 0) {
    return (
      <div className="space-y-2 rounded-md border border-danger/30 bg-surface p-3 text-foreground">
        <p className="text-sm">
          Le collaborateur doit rendre <strong>{fcfa(ecart)}</strong> de plus (proposé {fcfa(montantPropose)} − déjà
          réceptionné {fcfa(montantRecu)}). Un retour complémentaire distinct sera créé ; le retour d&apos;origine reste
          inchangé.
        </p>
        <Button
          type="button"
          loading={isPending}
          onClick={() =>
            startTransition(async () => {
              const r = await declarerRetourComplementaireAction(retourId);
              if (r.status === "success") {
                toast.success(r.message);
                router.refresh();
              } else toast.error(r.message);
            })
          }
        >
          Déclarer le retour complémentaire de {fcfa(ecart)}
        </Button>
      </div>
    );
  }

  const max = Math.abs(ecart);
  if (remboursementEnAttente) {
    return <p className="text-xs">Un remboursement est en attente de validation du Responsable Finance.</p>;
  }
  return (
    <div className="space-y-3 rounded-md border border-danger/30 bg-surface p-3 text-foreground">
      <p className="text-sm">
        Le collaborateur a rendu <strong>{fcfa(max)}</strong> de trop (proposé {fcfa(montantPropose)}, réceptionné{" "}
        {fcfa(montantRecu)}). Proposez un remboursement : la caisse ne sera débitée qu&apos;après validation du Responsable
        Finance.
      </p>
      <Input
        label="Montant à rembourser (FCFA)"
        type="number"
        min="0"
        max={max}
        hint={`Maximum ${fcfa(max)}`}
        value={montant}
        onChange={(e) => setMontant(e.target.value)}
      />
      <Textarea label="Motif" rows={2} value={motif} onChange={(e) => setMotif(e.target.value)} />
      <PieceJointeUpload label="Justificatif (obligatoire)" onChange={(url) => setPj(url ?? undefined)} />
      <Button
        type="button"
        loading={isPending}
        onClick={() => {
          if (!pj) return toast.error("Le justificatif est obligatoire.");
          startTransition(async () => {
            const r = await proposerRemboursementRetourAction(retourId, Number(montant), motif, pj);
            if (r.status === "success") {
              toast.success(r.message);
              router.refresh();
            } else toast.error(r.message);
          });
        }}
      >
        Proposer le remboursement
      </Button>
    </div>
  );
}

export function RemboursementDecision({ remboursementId }: { remboursementId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [motifRejet, setMotifRejet] = useState("");
  const [rejet, setRejet] = useState(false);

  function run(fn: () => Promise<{ status: string; message: string }>) {
    startTransition(async () => {
      const r = await fn();
      if (r.status === "success") {
        toast.success(r.message);
        router.refresh();
      } else toast.error(r.message);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" loading={isPending} onClick={() => run(() => validerRemboursementRetourAction(remboursementId))}>
          Valider le remboursement
        </Button>
        <Button type="button" variant="secondary" disabled={isPending} onClick={() => setRejet((v) => !v)}>
          Rejeter
        </Button>
      </div>
      {rejet ? (
        <div className="space-y-2">
          <Textarea label="Motif du rejet" rows={2} value={motifRejet} onChange={(e) => setMotifRejet(e.target.value)} />
          <Button
            type="button"
            variant="danger"
            loading={isPending}
            onClick={() => run(() => rejeterRemboursementRetourAction(remboursementId, motifRejet))}
          >
            Confirmer le rejet
          </Button>
        </div>
      ) : null}
    </div>
  );
}

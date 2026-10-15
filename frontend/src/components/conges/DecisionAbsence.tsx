"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button, Textarea } from "@/components/ui";
import type { ActionState, ActionsPossiblesAbsence } from "backend";

const MOTIF_MIN = 3;

type Motif = "rejet" | "modification" | "annulation";

export interface ActionsDecision {
  approuver: (id: string) => Promise<ActionState>;
  rejeter: (id: string, motif: string) => Promise<ActionState>;
  demanderModification?: (id: string, motif: string) => Promise<ActionState>;
  annuler: (id: string, motif: string) => Promise<ActionState>;
}

const CONFIG: Record<Motif, { titre: string; bouton: string; variante: "danger" | "secondary"; hint: string }> = {
  rejet: { titre: "Motif du rejet", bouton: "Confirmer le rejet", variante: "danger", hint: "Le demandeur verra ce motif." },
  modification: {
    titre: "Modification demandée",
    bouton: "Demander la modification",
    variante: "secondary",
    hint: "Le demandeur pourra corriger sa demande et la renvoyer.",
  },
  annulation: { titre: "Motif de l'annulation", bouton: "Confirmer l'annulation", variante: "danger", hint: "Le solde sera recrédité et l'absence autorisée supprimée." },
};

/**
 * Boutons de décision d'une demande d'absence (congé ou permission). Les boutons sont TOUJOURS visibles : un bouton
 * indisponible est grisé avec la phrase que renverrait le serveur (`actionsPossiblesAbsence`, même moteur) — le
 * serveur, lui, revérifie tout. Le motif est obligatoire (3 caractères) pour rejeter, demander une modification, annuler.
 */
export function DecisionAbsence({
  demandeId,
  possibles,
  actions,
  seulementAnnuler = false,
}: {
  demandeId: string;
  possibles: ActionsPossiblesAbsence;
  actions: ActionsDecision;
  /** Le demandeur n'a que l'annulation de sa propre demande : les boutons de décision ne sont pas affichés. */
  seulementAnnuler?: boolean;
}) {
  const [motifOuvert, setMotifOuvert] = useState<Motif | null>(null);
  const [motif, setMotif] = useState("");
  const [enCours, demarrer] = useTransition();
  const router = useRouter();

  const longueur = motif.trim().length;

  const executer = (appel: () => Promise<ActionState>) => {
    demarrer(async () => {
      const r = await appel();
      if (r.status === "success") {
        toast.success(r.message ?? "Décision enregistrée.");
        setMotifOuvert(null);
        setMotif("");
        router.refresh();
      } else if (r.status === "error") {
        toast.error(r.message);
      }
    });
  };

  const raisons = [possibles.approuver, possibles.rejeter, possibles.annuler].filter((r): r is string => r !== null);
  const rienPossible = possibles.approuver !== null && possibles.rejeter !== null && possibles.annuler !== null;
  // Une seule phrase d'explication (la plus parlante) sous les boutons grisés, jamais répétée par bouton.
  const phrase = rienPossible && !seulementAnnuler ? raisons[0] : null;

  if (motifOuvert) {
    const c = CONFIG[motifOuvert];
    const lancer = () => {
      if (motifOuvert === "rejet") return actions.rejeter(demandeId, motif);
      if (motifOuvert === "annulation") return actions.annuler(demandeId, motif);
      return actions.demanderModification ? actions.demanderModification(demandeId, motif) : Promise.resolve<ActionState>({ status: "error", message: "Non disponible." });
    };
    return (
      <div className="space-y-3">
        <Textarea
          label={c.titre}
          required
          rows={3}
          maxLength={500}
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          error={longueur > 0 && longueur < MOTIF_MIN ? `${MOTIF_MIN} caractères minimum.` : undefined}
          hint={c.hint}
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant={c.variante === "danger" ? "danger" : "primary"} loading={enCours} disabled={longueur < MOTIF_MIN} onClick={() => executer(lancer)}>
            {c.bouton}
          </Button>
          <Button variant="secondary" disabled={enCours} onClick={() => setMotifOuvert(null)}>
            Retour
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {seulementAnnuler ? null : (
          <>
            <Button variant="primary" loading={enCours} disabled={possibles.approuver !== null} title={possibles.approuver ?? undefined} onClick={() => executer(() => actions.approuver(demandeId))}>
              Approuver
            </Button>
            <Button variant="danger" disabled={enCours || possibles.rejeter !== null} title={possibles.rejeter ?? undefined} onClick={() => setMotifOuvert("rejet")}>
              Rejeter
            </Button>
            {actions.demanderModification ? (
              <Button variant="secondary" disabled={enCours || possibles.demanderModification !== null} title={possibles.demanderModification ?? undefined} onClick={() => setMotifOuvert("modification")}>
                Demander une modification
              </Button>
            ) : null}
          </>
        )}
        <Button variant="secondary" disabled={enCours || possibles.annuler !== null} title={possibles.annuler ?? undefined} onClick={() => setMotifOuvert("annulation")}>
          Annuler la demande
        </Button>
      </div>
      {phrase ? <p className="text-xs text-muted-foreground">{phrase}</p> : null}
    </div>
  );
}

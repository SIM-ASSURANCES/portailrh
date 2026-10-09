"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge, Button, Textarea } from "@/components/ui";

import { deciderLigneDGAction } from "../../circuit/actions";

const MOTIF_MIN = 3;

export interface LigneSoumiseDG {
  id: string;
  libelle: string;
  motif: string | null;
  quantite: number;
  prixUnitaire: number;
  categorieLabel: string | null;
  objetLabel: string | null;
  decisionDG: "VALIDEE" | "REFUSEE" | null;
  decisionDGParNom: string | null;
  decisionDGAt: Date | null;
  motifRefusDG: string | null;
  soumiseParNom: string | null;
}

/**
 * Lignes soumises au DG par la Finance (2026-10-10) : le DG ne voit et ne décide QUE celles-ci, une par une — Valider,
 * ou Refuser avec motif (la ligne revient à la Finance). Boutons grisés hors de son étape avec la phrase du moteur
 * (`raisonDecider`), que le serveur renverrait de toute façon.
 */
export function DecisionLignesDG({
  lignes,
  devise,
  raisonDecider,
}: {
  lignes: LigneSoumiseDG[];
  devise: string;
  raisonDecider: string | null;
}) {
  const enAttente = lignes.filter((l) => l.decisionDG === null).length;
  return (
    <section
      aria-label="Lignes soumises au DG"
      data-lignes-soumises-dg
      className="space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-elevated sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lignes soumises par la Finance</h2>
        <p className="text-xs text-muted-foreground">
          {lignes.length} ligne{lignes.length > 1 ? "s" : ""} · {enAttente} en attente de votre décision
        </p>
      </div>
      {lignes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune ligne ne vous a été soumise pour cette demande.</p>
      ) : (
        <ul className="space-y-3">
          {lignes.map((l) => (
            <LigneDG key={l.id} ligne={l} devise={devise} raisonDecider={raisonDecider} />
          ))}
        </ul>
      )}
      {raisonDecider && enAttente > 0 ? <p className="text-xs text-muted-foreground">{raisonDecider}</p> : null}
    </section>
  );
}

function LigneDG({ ligne, devise, raisonDecider }: { ligne: LigneSoumiseDG; devise: string; raisonDecider: string | null }) {
  const [refusOuvert, setRefusOuvert] = useState(false);
  const [motif, setMotif] = useState("");
  const [isPending, startTransition] = useTransition();
  const motifValide = motif.trim().length >= MOTIF_MIN;

  function decider(valider: boolean) {
    startTransition(async () => {
      const r = await deciderLigneDGAction(ligne.id, valider, valider ? undefined : motif);
      if (r.status === "success") {
        toast.success(r.message);
        setRefusOuvert(false);
        setMotif("");
      } else {
        toast.error(r.message);
      }
    });
  }

  return (
    <li data-ligne-dg={ligne.libelle} className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-foreground">{ligne.libelle}</p>
          {ligne.motif ? <p className="text-xs text-muted-foreground">Motif : {ligne.motif}</p> : null}
          <p className="text-xs text-muted-foreground tabular-nums">
            {ligne.quantite} × {ligne.prixUnitaire.toLocaleString("fr-FR")} {devise}
            {ligne.categorieLabel ? ` · ${ligne.categorieLabel}${ligne.objetLabel ? ` / ${ligne.objetLabel}` : ""}` : ""}
          </p>
          {ligne.soumiseParNom ? <p className="text-xs text-muted-foreground">Soumise par {ligne.soumiseParNom}</p> : null}
        </div>
        <p className="text-lg font-black tabular-nums text-foreground">
          {(ligne.quantite * ligne.prixUnitaire).toLocaleString("fr-FR")} {devise}
        </p>
      </div>

      {ligne.decisionDG !== null ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant={ligne.decisionDG === "VALIDEE" ? "success" : "danger"}>
            {ligne.decisionDG === "VALIDEE" ? "Validée" : "Refusée"}
          </Badge>
          <span className="text-muted-foreground">
            {ligne.decisionDGParNom ? `par ${ligne.decisionDGParNom}` : ""}
            {ligne.decisionDGAt ? ` le ${ligne.decisionDGAt.toLocaleDateString("fr-FR")}` : ""}
            {ligne.decisionDG === "REFUSEE" && ligne.motifRefusDG ? ` — motif : ${ligne.motifRefusDG}` : ""}
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" loading={isPending && !refusOuvert} disabled={!!raisonDecider || isPending} onClick={() => decider(true)}>
              Valider
            </Button>
            <Button type="button" variant="danger" disabled={!!raisonDecider || isPending} onClick={() => setRefusOuvert((v) => !v)}>
              Refuser
            </Button>
          </div>
          {refusOuvert && !raisonDecider ? (
            <div className="space-y-2">
              <Textarea
                label="Motif du refus (transmis à la Finance)"
                required
                rows={2}
                value={motif}
                onChange={(e) => setMotif(e.target.value)}
                error={motif.length > 0 && !motifValide ? `${MOTIF_MIN} caractères minimum.` : undefined}
              />
              <Button type="button" variant="danger" loading={isPending} disabled={!motifValide || isPending} onClick={() => decider(false)}>
                Confirmer le refus
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </li>
  );
}

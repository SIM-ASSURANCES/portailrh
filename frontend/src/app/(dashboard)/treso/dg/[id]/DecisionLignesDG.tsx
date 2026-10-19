"use client";

import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { EnteteDemandeArticle, type ContexteDemandeArticle } from "@/components/tresorerie/EnteteDemandeArticle";
import { BudgetPrevision } from "@/components/tresorerie/BudgetPrevision";
import { Badge, Button, Input, Textarea } from "@/components/ui";
import { MOTIF_DEPASSEMENT_MIN, previsionBudget, verdictBudget } from "backend/client";

import { deciderLigneDGAction } from "../../circuit/actions";
import type { BudgetValidation } from "../../finance/demandes/[id]/LignesValidationTable";

const MOTIF_MIN = 3;

export interface LigneSoumiseDG {
  id: string;
  libelle: string;
  motif: string | null;
  quantite: number;
  prixUnitaire: number;
  categorieLabel: string | null;
  /** Lot J : catégorie de l'article (budget de la catégorie touché par la validation). */
  categorieId?: string | null;
  objetLabel: string | null;
  decisionDG: "VALIDEE" | "REFUSEE" | null;
  decisionDGParNom: string | null;
  decisionDGAt: Date | null;
  motifRefusDG: string | null;
  soumiseParNom: string | null;
  /** Bénéficiaire et pièces de l'article (autonomie des articles, lot A). */
  details?: ReactNode;
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
  enteteDemande,
  budget = null,
}: {
  enteteDemande?: ContexteDemandeArticle;
  /** Lot J : budgets en vigueur ; le reste après la validation de chaque article est affiché au DG. */
  budget?: BudgetValidation | null;
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
            <LigneDG key={l.id} ligne={l} devise={devise} raisonDecider={raisonDecider} enteteDemande={enteteDemande} budget={budget} />
          ))}
        </ul>
      )}
      {raisonDecider && enAttente > 0 ? <p className="text-xs text-muted-foreground">{raisonDecider}</p> : null}
    </section>
  );
}

function LigneDG({
  ligne,
  devise,
  raisonDecider,
  enteteDemande,
  budget,
}: {
  ligne: LigneSoumiseDG;
  devise: string;
  raisonDecider: string | null;
  enteteDemande?: ContexteDemandeArticle;
  budget: BudgetValidation | null;
}) {
  const [refusOuvert, setRefusOuvert] = useState(false);
  const [motif, setMotif] = useState("");
  const [isPending, startTransition] = useTransition();
  const motifValide = motif.trim().length >= MOTIF_MIN;
  // Lot J : reste du budget global et de la catégorie APRÈS la validation de cet article. Rouge : le DG confirme le
  // dépassement dans ce même geste (motif obligatoire), tracé dans l'historique.
  const [motifDepassement, setMotifDepassement] = useState("");
  const montantLigne = ligne.quantite * ligne.prixUnitaire;
  const prevision = budget && ligne.decisionDG === null ? previsionBudget(budget.contexte, [{ categorieId: ligne.categorieId ?? null, montant: montantLigne }]) : null;
  const verdict = budget && prevision ? verdictBudget({ prevision, acteurEstDG: true, motifConfirmation: motifDepassement, confirmationExistante: false }) : null;
  const depassementBloque = verdict !== null && !verdict.autorise;

  function decider(valider: boolean) {
    startTransition(async () => {
      const r = await deciderLigneDGAction(ligne.id, valider, valider ? undefined : motif, valider && prevision?.niveau === "ROUGE" ? motifDepassement.trim() : undefined);
      if (r.status === "success") {
        toast.success(r.message);
        setRefusOuvert(false);
        setMotif("");
        setMotifDepassement("");
      } else {
        toast.error(r.message);
      }
    });
  }

  return (
    <li data-ligne-dg={ligne.libelle} className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {enteteDemande ? <EnteteDemandeArticle contexte={enteteDemande} /> : null}
          <p className="font-bold text-foreground">{ligne.libelle}</p>
          {ligne.motif ? <p className="text-xs text-muted-foreground">Motif : {ligne.motif}</p> : null}
          {ligne.details}
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
          {prevision ? <BudgetPrevision prevision={prevision} titre="Budget après la validation de cet article" /> : null}
          {prevision && prevision.niveau === "ORANGE" ? (
            <p data-alerte-budget="ORANGE" role="status" className="rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm font-medium text-foreground">
              Alerte orange : cette validation rapproche un budget de son seuil. Vous pouvez valider ; la Finance et le DG sont prévenus.
            </p>
          ) : null}
          {prevision && prevision.niveau === "ROUGE" ? (
            <div data-alerte-budget="ROUGE" role="alert" className="space-y-2 rounded-md border border-danger bg-danger-bg px-3 py-2">
              <p className="text-sm font-semibold text-foreground">
                Alerte rouge : valider cet article atteint le seuil rouge d&apos;un budget. Confirmez le dépassement (motif obligatoire) pour valider ; tracé dans l&apos;historique.
              </p>
              <Input
                name={`motifDepassement-${ligne.id}`}
                label="Motif de la confirmation du dépassement"
                required
                value={motifDepassement}
                onChange={(e) => setMotifDepassement(e.target.value)}
                hint={`${MOTIF_DEPASSEMENT_MIN} caractères minimum.`}
              />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" loading={isPending && !refusOuvert} disabled={!!raisonDecider || isPending || depassementBloque} onClick={() => decider(true)}>
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

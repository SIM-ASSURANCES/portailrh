"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ChampMotifEchange, motifEchangeValide } from "@/components/tresorerie/ChampMotifEchange";
import { Button } from "@/components/ui";

import { deciderBudgetsCategoriesAction, deciderSeuilsCaisseAction } from "./actions";
import { DecisionParametrage } from "./DecisionParametrage";

export interface ParametrageEnAttenteItem {
  id: string;
  titre: string;
  detail: string;
  soumisPar: string;
  /** Motif de la Finance (lot M), « Non renseigné » pour un ancien paramétrage. */
  motifSoumission: string;
  /** Soumis par le compte connecté : il ne peut pas le décider (inchangé depuis le lot J). */
  soiMeme: boolean;
}

/**
 * Paramétrages d'UNE section en attente du DG (lots J ter et J quater : une liste par section, `portee` choisit l'action) : chaque budget se décide SEUL (Valider / Rejeter avec son motif) ou en LOT
 * (cases à cocher, « Valider la sélection » / « Rejeter la sélection » avec un motif commun, obligatoire dans les deux cas — lot M). Chaque élément garde sa propre trace
 * dans l'historique ; le DG ne décide jamais ce qu'il a lui-même soumis (case désactivée, et ignoré côté serveur).
 */
export function ParametragesEnAttente({ items, portee }: { items: ParametrageEnAttenteItem[]; portee: "GLOBAL" | "CATEGORIE" }) {
  const [coches, setCoches] = useState<Set<string>>(new Set());
  const [motif, setMotif] = useState("");
  const [isPending, startTransition] = useTransition();

  const decidables = items.filter((i) => !i.soiMeme);
  const selection = items.filter((i) => coches.has(i.id) && !i.soiMeme);

  function basculer(id: string) {
    setCoches((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function decider(valider: boolean) {
    startTransition(async () => {
      const decideur = portee === "GLOBAL" ? deciderSeuilsCaisseAction : deciderBudgetsCategoriesAction;
      const r = await decideur(selection.map((i) => ({ id: i.id })), valider, motif.trim());
      if (r.status === "success") {
        toast.success(r.message);
        setCoches(new Set());
        setMotif("");
      } else {
        toast.error(r.message);
      }
    });
  }

  return (
    <div data-parametrages-en-attente className="space-y-4">
      {decidables.length > 1 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 p-3" data-decision-lot>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              data-coche-tout
              checked={selection.length === decidables.length}
              onChange={(e) => setCoches(e.target.checked ? new Set(decidables.map((i) => i.id)) : new Set())}
            />
            Tout sélectionner
          </label>
          <div className="w-full max-w-md">
            <ChampMotifEchange name="motifDecisionLot" label="Motif commun de la décision du DG" hint="Décider un budget seul permet un motif propre." value={motif} onChange={setMotif} disabled={isPending} />
          </div>
          <Button signe type="button" loading={isPending} disabled={selection.length === 0 || isPending || !motifEchangeValide(motif)} data-valider-selection onClick={() => decider(true)}>
            Valider la sélection ({selection.length})
          </Button>
          <Button signe type="button" variant="danger" disabled={selection.length === 0 || isPending || !motifEchangeValide(motif)} data-refuser-selection onClick={() => decider(false)}>
            Rejeter la sélection ({selection.length})
          </Button>
        </div>
      ) : null}

      <ul className="space-y-3">
        {items.map((i) => (
          <li key={i.id} data-parametrage-attente={i.id} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-start gap-3">
              <input type="checkbox" data-coche-parametrage={i.id} aria-label={`Sélectionner ${i.titre}`} disabled={i.soiMeme} checked={coches.has(i.id)} onChange={() => basculer(i.id)} className="mt-1" />
              <div className="space-y-1">
                <p className="text-sm text-foreground">
                  <span className="font-semibold">{i.titre}</span> — {i.detail}
                </p>
                <p className="text-xs text-muted-foreground">{i.soumisPar}</p>
                <p data-motif-soumission className="text-xs text-muted-foreground">Motif de la Finance : {i.motifSoumission}</p>
              </div>
            </div>
            <div className="pl-7">
              <DecisionParametrage id={i.id} portee={portee} desactive={i.soiMeme} raison={i.soiMeme ? "Vous ne pouvez pas décider un paramétrage que vous avez soumis." : undefined} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

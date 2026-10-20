"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Input } from "@/components/ui";

import { deciderBudgetsCategoriesAction, deciderSeuilsCaisseAction } from "./actions";
import { DecisionParametrage } from "./DecisionParametrage";

export interface ParametrageEnAttenteItem {
  id: string;
  titre: string;
  detail: string;
  soumisPar: string;
  /** Soumis par le compte connecté : il ne peut pas le décider (inchangé depuis le lot J). */
  soiMeme: boolean;
}

/**
 * Paramétrages d'UNE section en attente du DG (lots J ter et J quater : une liste par section, `portee` choisit l'action) : chaque budget se décide SEUL (Valider / Refuser avec son motif) ou en LOT
 * (cases à cocher, « Valider la sélection » / « Refuser la sélection » avec un motif commun). Chaque élément garde sa propre trace
 * dans l'historique ; le DG ne décide jamais ce qu'il a lui-même soumis (case désactivée, et ignoré côté serveur).
 */
export function ParametragesEnAttente({ items, portee }: { items: ParametrageEnAttenteItem[]; portee: "GLOBAL" | "CATEGORIE" }) {
  const [coches, setCoches] = useState<Set<string>>(new Set());
  const [refus, setRefus] = useState(false);
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
      const r = await decideur(selection.map((i) => ({ id: i.id })), valider, valider ? undefined : motif);
      if (r.status === "success") {
        toast.success(r.message);
        setCoches(new Set());
        setRefus(false);
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
          <Button signe type="button" loading={isPending} disabled={selection.length === 0 || isPending} data-valider-selection onClick={() => decider(true)}>
            Valider la sélection ({selection.length})
          </Button>
          <Button type="button" variant="danger" disabled={selection.length === 0 || isPending} data-refuser-selection onClick={() => setRefus((v) => !v)}>
            Refuser la sélection ({selection.length})
          </Button>
          {refus && selection.length > 0 ? (
            <div className="flex w-full flex-wrap items-end gap-2">
              <div className="w-80">
                <Input name="motifRefusLot" label="Motif commun du refus" required value={motif} onChange={(e) => setMotif(e.target.value)} hint="3 caractères minimum. Refuser un budget seul permet un motif propre." />
              </div>
              <Button signe type="button" variant="danger" loading={isPending} disabled={motif.trim().length < 3 || isPending} data-confirmer-refus-selection onClick={() => decider(false)}>
                Confirmer le refus de la sélection
              </Button>
            </div>
          ) : null}
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

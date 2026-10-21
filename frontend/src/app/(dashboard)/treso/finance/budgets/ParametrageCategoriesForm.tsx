"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Input } from "@/components/ui";
import { libelleSeuil, type SeuilBudget } from "backend/client";

import { soumettreBudgetsCategoriesAction } from "./actions";

type ModeSeuil = "AUCUN" | "POURCENTAGE" | "MONTANT";

export interface LigneCategorieSaisie {
  id: string;
  label: string;
  /** Budget en vigueur (pré-remplit la ligne, jamais modifié en place). */
  actuel: { montant: number; seuil: SeuilBudget | null } | null;
  /** Un paramétrage de cette catégorie attend déjà la décision du DG. */
  enAttente: boolean;
}

interface Ligne {
  coche: boolean;
  montant: string;
  mode: ModeSeuil;
  orange: string;
  rouge: string;
}

const CLASSE_CHAMP =
  "block w-full rounded-lg border border-border px-2 py-1.5 text-sm text-foreground tabular-nums focus:outline-2 focus:outline-offset-2 focus:outline-primary disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

const ligneInitiale = (actuel: LigneCategorieSaisie["actuel"]): Ligne => ({
  coche: false,
  montant: actuel ? String(actuel.montant) : "",
  mode: actuel?.seuil?.mode ?? "POURCENTAGE",
  orange: String(actuel?.seuil?.orange ?? 20),
  rouge: String(actuel?.seuil?.rouge ?? 10),
});

/**
 * Paramétrage des budgets de CATÉGORIE (lot J quater ; le budget de caisse a son propre formulaire, `ParametrageCaisseForm`).
 * Un seul formulaire pour UN budget ou PLUSIEURS d'un coup : cases à cocher puis « Soumettre la sélection ». Les dates d'effet
 * (début, fin facultative) sont communes à la sélection. Par catégorie : montant, puis seuils d'alerte en pourcentage restant OU en
 * montant restant (orange puis rouge plus bas). La sélection est soumise au DG et ne sert qu'une fois validée ; elle ne modifie
 * jamais un budget en vigueur.
 */
export function ParametrageCategoriesForm({ categories, aujourdhui }: { categories: LigneCategorieSaisie[]; aujourdhui: string }) {
  const [dateDebut, setDateDebut] = useState(aujourdhui);
  const [dateFin, setDateFin] = useState("");
  const [lignes, setLignes] = useState<Record<string, Ligne>>(() => Object.fromEntries(categories.map((c) => [c.id, ligneInitiale(c.actuel)])));
  const [erreurs, setErreurs] = useState<Record<string, Record<string, string>>>({});
  const [isPending, startTransition] = useTransition();

  // Une catégorie créée pendant que le formulaire est affiché (rafraîchissement) n'a pas encore d'état : on part de ses valeurs courantes.
  const defaut = (cle: string): Ligne => ligneInitiale(categories.find((c) => c.id === cle)?.actuel ?? null);
  const ligneDe = (cle: string): Ligne => lignes[cle] ?? defaut(cle);
  const maj = (cle: string, patch: Partial<Ligne>) => setLignes((l) => ({ ...l, [cle]: { ...(l[cle] ?? defaut(cle)), ...patch } }));
  const cochees = categories.map((c) => c.id).filter((k) => ligneDe(k).coche);

  function soumettre() {
    setErreurs({});
    const saisies = cochees.map((k) => {
      const l = ligneDe(k);
      return {
        portee: "CATEGORIE" as const,
        categorieId: k,
        montant: Number(l.montant),
        dateDebut,
        dateFin: dateFin || null,
        seuil: l.mode !== "AUCUN" ? { mode: l.mode as "POURCENTAGE" | "MONTANT", orange: Number(l.orange), rouge: Number(l.rouge) } : null,
      };
    });
    startTransition(async () => {
      const r = await soumettreBudgetsCategoriesAction(saisies);
      if (r.status === "success") {
        toast.success(r.message);
        setLignes((l) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, { ...v, coche: false }])));
        setDateFin("");
      } else {
        const parCle: Record<string, Record<string, string>> = {};
        for (const [i, e] of Object.entries(r.erreursParIndex ?? {})) parCle[cochees[Number(i)]] = e;
        setErreurs(parCle);
        toast.error(r.message);
      }
    });
  }

  const ligneChamps = (cle: string, desactive: boolean) => {
    const l = ligneDe(cle);
    const e = erreurs[cle] ?? {};
    const unite = l.mode === "MONTANT" ? "FCFA" : "%";
    return (
      <>
        <td className="px-2 py-2 align-top">
          <input
            aria-label={`Montant du budget (FCFA) — ${cle}`}
            name={`montant-${cle}`}
            type="number"
            min={0}
            step="0.01"
            className={CLASSE_CHAMP}
            disabled={desactive}
            value={l.montant}
            onChange={(ev) => maj(cle, { montant: ev.target.value, coche: ev.target.value !== "" ? true : l.coche })}
          />
          {e.montant ? <p className="mt-1 text-xs text-danger">{e.montant}</p> : null}
        </td>
        <td className="px-2 py-2 align-top">
          <select aria-label={`Mesurer le reste en — ${cle}`} name={`mode-${cle}`} className={CLASSE_CHAMP} disabled={desactive} value={l.mode} onChange={(ev) => maj(cle, { mode: ev.target.value as ModeSeuil })}>
            <option value="POURCENTAGE">Pourcentage restant</option>
            <option value="MONTANT">Montant restant</option>
            <option value="AUCUN">Aucune alerte</option>
          </select>
          {e.seuilMode ? <p className="mt-1 text-xs text-danger">{e.seuilMode}</p> : null}
        </td>
        <td className="px-2 py-2 align-top">
          {l.mode !== "AUCUN" ? (
            <>
              <input aria-label={`Seuil orange (${unite}) — ${cle}`} name={`orange-${cle}`} type="number" min={0} step="0.01" className={CLASSE_CHAMP} disabled={desactive} value={l.orange} onChange={(ev) => maj(cle, { orange: ev.target.value })} />
              {e.seuilOrange ? <p className="mt-1 text-xs text-danger">{e.seuilOrange}</p> : null}
            </>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-2 py-2 align-top">
          {l.mode !== "AUCUN" ? (
            <>
              <input aria-label={`Seuil rouge (${unite}) — ${cle}`} name={`rouge-${cle}`} type="number" min={0} step="0.01" className={CLASSE_CHAMP} disabled={desactive} value={l.rouge} onChange={(ev) => maj(cle, { rouge: ev.target.value })} />
              {e.seuilRouge ? <p className="mt-1 text-xs text-danger">{e.seuilRouge}</p> : null}
            </>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </td>
      </>
    );
  };

  return (
    <form
      data-parametrage-budget-form
      data-lot-budgets-form
      onSubmit={(e) => {
        e.preventDefault();
        soumettre();
      }}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input name="dateDebut" label="Date d'effet (début) — commune à la sélection" type="date" required min={aujourdhui} value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} hint="Jamais dans le passé : le nouveau budget remplace l'ancien à cette date." />
        <Input name="dateFin" label="Date de fin (facultative)" type="date" min={dateDebut} value={dateFin} onChange={(e) => setDateFin(e.target.value)} hint="Vide : sans date de fin." />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-left text-sm">
          <thead className="text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-2 py-2">Soumettre</th>
              <th className="px-2 py-2">Catégorie</th>
              <th className="px-2 py-2">Montant (FCFA)</th>
              <th className="px-2 py-2">Seuils mesurés en…</th>
              <th className="px-2 py-2">Orange ≤</th>
              <th className="px-2 py-2">Rouge ≤</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id} data-budget-ligne-saisie={c.label} className="border-t border-border">
                <td className="px-2 py-2 align-top">
                  <input type="checkbox" data-coche-budget={c.label} aria-label={`Soumettre le budget ${c.label}`} disabled={c.enAttente} checked={ligneDe(c.id).coche} onChange={(ev) => maj(c.id, { coche: ev.target.checked })} />
                </td>
                <td className="px-2 py-2 align-top">
                  <p className="font-semibold text-foreground">{c.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.actuel ? `En vigueur : ${c.actuel.montant.toLocaleString("fr-FR")} FCFA — ${libelleSeuil(c.actuel.seuil)}` : "Aucun budget en vigueur."}
                  </p>
                  {c.enAttente ? <p className="text-xs font-semibold text-warning">Un paramétrage attend déjà la décision du DG.</p> : null}
                  {erreurs[c.id]?.categorieId ? <p className="text-xs text-danger">{erreurs[c.id].categorieId}</p> : null}
                </td>
                {ligneChamps(c.id, c.enAttente)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">Cochez un budget pour le soumettre seul, ou plusieurs pour les soumettre ensemble au DG.</p>

      <Button signe type="submit" loading={isPending} disabled={cochees.length === 0 || isPending} data-soumettre-selection>
        {cochees.length <= 1 ? "Soumettre la sélection au DG" : `Soumettre la sélection au DG (${cochees.length} budgets)`}
      </Button>
    </form>
  );
}

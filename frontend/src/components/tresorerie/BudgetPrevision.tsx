import { Badge, type BadgeVariant } from "@/components/ui";
import { libelleNiveauBudget, libelleSeuil, type LignePrevision, type NiveauAlerteBudget, type PrevisionBudget } from "backend/client";

const VARIANTE: Record<NiveauAlerteBudget, BadgeVariant> = { AUCUN: "success", ORANGE: "warning", ROUGE: "danger" };

/** Badge du niveau d'alerte d'un budget (Dans la limite / Alerte orange / Alerte rouge). */
export function BadgeNiveauBudget({ niveau }: { niveau: NiveauAlerteBudget }) {
  return (
    <Badge variant={VARIANTE[niveau]}>
      <span data-niveau-budget={niveau}>{libelleNiveauBudget(niveau)}</span>
    </Badge>
  );
}

const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

function LigneBudget({ l }: { l: LignePrevision }) {
  return (
    <li
      data-budget-prevision={l.portee === "GLOBAL" ? "global" : "categorie"}
      data-niveau-budget={l.niveau}
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2"
    >
      <span className="text-sm text-foreground">
        <span className="font-semibold">{l.portee === "GLOBAL" ? "Budget global" : `Budget « ${l.libelle} »`}</span>
        {" — "}
        <span data-reste-apres className="font-black tabular-nums">
          {l.resteApres < 0 ? `dépassé de ${fcfa(Math.abs(l.resteApres))}` : `reste ${fcfa(l.resteApres)}`}
        </span>{" "}
        <span className="text-muted-foreground">
          après cette validation ({l.resteApres < 0 ? `budget de ${fcfa(l.budget)}` : `${l.pctRestantApres.toLocaleString("fr-FR")} % de ${fcfa(l.budget)}`})
        </span>
        {l.ajout > 0 ? <span className="text-muted-foreground"> · avant : reste {fcfa(l.resteAvant)}</span> : null}
        {l.seuil ? <span className="block text-xs text-muted-foreground">{libelleSeuil(l.seuil)}</span> : null}
      </span>
      <BadgeNiveauBudget niveau={l.niveau} />
    </li>
  );
}

/**
 * Reste du budget global ET de chaque catégorie touchée, APRÈS la validation en cours (prévisionnel : rien n'est écrit).
 * Affiché à chaque validation (Finance et DG). Ne rend rien quand aucun budget n'est en vigueur pour les montants validés.
 */
export function BudgetPrevision({ prevision, titre = "Budget après cette validation" }: { prevision: PrevisionBudget; titre?: string }) {
  const lignes = [prevision.global, ...prevision.categories].filter((l): l is LignePrevision => !!l);
  if (lignes.length === 0) return null;
  return (
    <div data-budget-bloc data-niveau-budget={prevision.niveau} className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titre}</p>
      <ul className="space-y-1.5">
        {lignes.map((l) => (
          <LigneBudget key={`${l.portee}-${l.categorieId ?? "g"}`} l={l} />
        ))}
      </ul>
    </div>
  );
}

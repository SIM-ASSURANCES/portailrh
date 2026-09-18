import { EmptyState } from "@/components/ui";

const SIZE = 140;
const STROKE = 14;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCONFERENCE = 2 * Math.PI * RADIUS;

/** Seuils de teinte — un taux de régularisation est une mesure de
 * "discipline administrative", pas un statut métier avec ses propres
 * tokens dédiés : réutilise directement les teintes sémantiques déjà
 * existantes (success/warning/danger), jamais une nouvelle échelle de
 * couleur inventée pour ce seul indicateur. */
function toneForTaux(taux: number): "success" | "warning" | "danger" {
  if (taux >= 80) return "success";
  if (taux >= 40) return "warning";
  return "danger";
}

const STROKE_COLOR = {
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)",
} as const;

const TEXT_CLASS = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
} as const;

/**
 * Anneau SVG tracé à la main (même technique que `ReglementsModeDonut.tsx`,
 * un seul arc au lieu de plusieurs segments) — pourcentage des demandes
 * RÉGLÉES du Collaborateur (`montantRecu > 0`) qui sont déjà entièrement
 * RÉGULARISÉES (`soldeARegulariser === 0`), voir CLAUDE.md "Modernisation
 * du dashboard Collaborateur".
 *
 * **Ne recalcule RIEN** : `demandesReglees`/`demandesRegularisees` sont
 * dérivés dans `page.tsx` directement du tableau déjà renvoyé par
 * `getMesDemandesDetail` (même `montantRecu`/`soldeARegulariser` que
 * `MesDemandesDetailTable`/`EtatRegularisation` — jamais une deuxième
 * définition de ces seuils). Aucune requête supplémentaire.
 *
 * État vide dédié (`EmptyState`) si aucune demande réglée n'existe encore
 * — un anneau à 0% serait trompeur (jamais "en train d'échouer à se
 * régulariser", simplement "rien à régulariser pour l'instant").
 */
export function TauxRegularisationGauge({
  demandesReglees,
  demandesRegularisees,
}: {
  demandesReglees: number;
  demandesRegularisees: number;
}) {
  if (demandesReglees === 0) {
    return (
      <EmptyState
        icon="circle-check"
        message="Aucune demande réglée pour l'instant — rien à régulariser."
        compact
      />
    );
  }

  const taux = Math.round((demandesRegularisees / demandesReglees) * 100);
  const tone = toneForTaux(taux);
  const dashArray = `${((taux / 100) * CIRCONFERENCE).toFixed(1)} ${CIRCONFERENCE.toFixed(1)}`;

  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="var(--color-muted)" strokeWidth={STROKE} />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={STROKE_COLOR[tone]}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={dashArray}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-2xl font-black tabular-nums ${TEXT_CLASS[tone]}`}>{taux}%</span>
          <span className="text-[10px] font-medium text-muted-foreground">régularisé</span>
        </div>
      </div>
      <dl className="space-y-1.5 text-sm">
        <div>
          <dt className="inline font-semibold text-foreground">{demandesRegularisees}</dt>
          <dd className="inline text-muted-foreground"> demande(s) régularisée(s)</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-foreground">{demandesReglees}</dt>
          <dd className="inline text-muted-foreground"> demande(s) réglée(s) au total</dd>
        </div>
        <p className="pt-1 text-xs text-muted-foreground">
          Une demande réglée est &laquo;&nbsp;régularisée&nbsp;&raquo; une fois son retour de caisse traité
          (solde à régulariser à 0).
        </p>
      </dl>
    </div>
  );
}

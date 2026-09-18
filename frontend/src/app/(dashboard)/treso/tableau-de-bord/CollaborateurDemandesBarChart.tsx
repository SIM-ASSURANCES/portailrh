import { EmptyState } from "@/components/ui";
import type { MoisMontantDemande } from "backend";

const WIDTH = 600;
const HEIGHT = 200;
const PAD_TOP = 28;
const PAD_BOTTOM = 26;
const PAD_X = 8;
const GAP_FRACTION = 0.38;

/** Formatage compact des montants au-dessus des barres ("1,2M", "850k") —
 * l'espace au-dessus d'une barre étroite ne tolère pas "1 200 000 FCFA" en
 * toutes lettres, contrairement aux 5 cartes "Vue d'ensemble" juste
 * au-dessus sur la page, qui gardent le format complet. */
function formatCompact(montant: number): string {
  if (montant >= 1_000_000) return `${(montant / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}M`;
  if (montant >= 1_000) return `${Math.round(montant / 1000)}k`;
  return `${montant}`;
}

/**
 * Évolution du montant DEMANDÉ par le Collaborateur, mois par mois — barres
 * SVG tracées à la main (voir CLAUDE.md "Modernisation du dashboard
 * Collaborateur" / `SoldeCaisseTrendChart.tsx` pour le même choix déjà fait
 * sur le dashboard Finance : volume toujours modeste, un rendu personnalisé
 * reste plus simple qu'une dépendance externe). Server Component pur.
 *
 * **Pas de `<title>` par barre** (infobulle native SVG) — même piège React
 * 19 déjà documenté sur `SoldeCaisseTrendChart.tsx` (hissé vers `<head>`,
 * provoque une erreur d'hydratation) : le montant de chaque mois est donc
 * affiché directement au-dessus de sa barre, jamais seulement au survol.
 *
 * `data` vient de `getMesDemandesParMois` — jamais de donnée inventée.
 * Deux cas de vide distincts, jamais un graphique cassé/vide sans
 * explication : aucune demande n'a JAMAIS existé (message dédié, cohérent
 * avec celui de `MesDemandesDetailTable`), ou aucune demande sur la
 * fenêtre récente alors que l'historique n'est pas vide (message distinct,
 * jamais confondu avec "vous n'avez jamais rien demandé").
 */
export function CollaborateurDemandesBarChart({
  data,
  aDejaDesDemandes,
}: {
  data: MoisMontantDemande[];
  aDejaDesDemandes: boolean;
}) {
  const total = data.reduce((sum, m) => sum + m.montant, 0);

  if (!aDejaDesDemandes) {
    return (
      <EmptyState icon="shopping-cart" message="Vous n'avez encore créé aucune demande." compact />
    );
  }

  if (total === 0) {
    return (
      <EmptyState
        icon="chart-bar"
        message={`Aucune demande sur les ${data.length} derniers mois — consultez "Mes demandes" pour l'historique complet.`}
        compact
      />
    );
  }

  const maxMontant = Math.max(...data.map((m) => m.montant), 1);
  const plotWidth = WIDTH - PAD_X * 2;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const slotWidth = plotWidth / data.length;
  const barWidth = slotWidth * (1 - GAP_FRACTION);

  return (
    <div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label="Montant demandé par mois">
        {data.map((m, i) => {
          const barHeight = maxMontant > 0 ? (m.montant / maxMontant) * plotHeight : 0;
          const x = PAD_X + i * slotWidth + (slotWidth - barWidth) / 2;
          const y = PAD_TOP + plotHeight - barHeight;
          const estMoisCourant = i === data.length - 1;
          return (
            <g key={m.mois}>
              {m.montant > 0 ? (
                <text
                  x={x + barWidth / 2}
                  y={y - 6}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  style={{ fontSize: 11, fontWeight: 600 }}
                >
                  {formatCompact(m.montant)}
                </text>
              ) : null}
              <rect
                x={x}
                y={m.montant > 0 ? y : PAD_TOP + plotHeight - 2}
                width={barWidth}
                height={m.montant > 0 ? barHeight : 2}
                rx={6}
                fill={estMoisCourant ? "#004b9c" : "#51aee2"}
                opacity={estMoisCourant ? 1 : 0.75}
              />
              <text
                x={x + barWidth / 2}
                y={HEIGHT - 6}
                textAnchor="middle"
                className="fill-muted-foreground"
                style={{ fontSize: 11 }}
              >
                {m.label}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-center text-xs text-muted-foreground">
        Total demandé sur la période : <span className="font-semibold text-foreground">{total.toLocaleString("fr-FR")} FCFA</span>
      </p>
    </div>
  );
}

import { EmptyState } from "@/components/ui";
import type { RepartitionModeReglement } from "backend";

const SIZE = 140;
const STROKE = 20;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCONFERENCE = 2 * Math.PI * RADIUS;

/** Couleurs officielles SIM Assurances directement (voir CLAUDE.md
 * palette) : bleu foncé pour Caisse, bleu clair pour Banque — même paire
 * que le dégradé du bandeau "hero", jamais une couleur hors charte pour
 * ce graphique à seulement deux catégories fixes. */
const COULEUR_PAR_MODE: Record<string, string> = {
  CAISSE: "#004B9C",
  BANQUE: "#51AEE2",
};

const LABEL_PAR_MODE: Record<string, string> = {
  CAISSE: "Caisse",
  BANQUE: "Banque",
};

interface Segment {
  mode: string;
  montant: number;
  nombre: number;
  fraction: number;
  dashArray: string;
  dashOffset: string;
  couleur: string;
}

/**
 * Répartition des règlements confirmés par mode de paiement sur la
 * période — anneau SVG tracé à la main (deux catégories fixes seulement,
 * pas besoin d'une bibliothèque de graphiques). `repartition` vient de
 * `getRepartitionReglementsParMode`, jamais de données inventées :
 * l'anneau est vide (`EmptyState`) si aucun règlement confirmé n'existe
 * sur la période plutôt qu'un anneau à 0% trompeur.
 */
export function ReglementsModeDonut({ repartition }: { repartition: RepartitionModeReglement[] }) {
  const total = repartition.reduce((sum, r) => sum + r.montant, 0);

  if (total === 0) {
    return <EmptyState icon="pie-chart" message="Aucun règlement confirmé sur cette période." compact />;
  }

  const { segments } = repartition.filter((r) => r.montant > 0).reduce<{ cumule: number; segments: Segment[] }>(
    (acc, r) => {
      const fraction = r.montant / total;
      const dashArray = `${(fraction * CIRCONFERENCE).toFixed(1)} ${CIRCONFERENCE.toFixed(1)}`;
      const dashOffset = (-acc.cumule * CIRCONFERENCE).toFixed(1);
      return {
        cumule: acc.cumule + fraction,
        segments: [
          ...acc.segments,
          {
            mode: r.mode,
            montant: r.montant,
            nombre: r.nombre,
            fraction,
            dashArray,
            dashOffset,
            couleur: COULEUR_PAR_MODE[r.mode] ?? "#94a3b8",
          },
        ],
      };
    },
    { cumule: 0, segments: [] }
  );

  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="var(--color-muted)" strokeWidth={STROKE} />
          {segments.map((s) => (
            <circle
              key={s.mode}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={s.couleur}
              strokeWidth={STROKE}
              strokeDasharray={s.dashArray}
              strokeDashoffset={s.dashOffset}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Total</span>
          <span className="text-sm font-black tabular-nums text-foreground">{total.toLocaleString("fr-FR")}</span>
          <span className="text-[10px] text-muted-foreground">FCFA</span>
        </div>
      </div>
      <dl className="space-y-2.5 text-sm">
        {segments.map((s) => (
          <div key={s.mode} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.couleur }} aria-hidden="true" />
            <dt className="font-semibold text-foreground">{LABEL_PAR_MODE[s.mode] ?? s.mode}</dt>
            <dd className="text-muted-foreground tabular-nums">
              {Math.round(s.fraction * 100)}% · {s.montant.toLocaleString("fr-FR")} FCFA ({s.nombre})
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

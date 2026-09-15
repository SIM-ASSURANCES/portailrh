import type { PointEvolutionSoldeCaisse } from "backend";

const WIDTH = 600;
const HEIGHT = 160;
const PAD_TOP = 12;
const PAD_BOTTOM = 22;
const PAD_X = 4;

/**
 * Courbe d'évolution du solde de caisse, tracée en SVG à la main (pas de
 * bibliothèque de graphiques — voir CLAUDE.md "Refonte visuelle du
 * dashboard Finance" : volume de points toujours modeste, un rendu
 * personnalisé reste plus simple qu'une dépendance externe pour ce seul
 * besoin). Server Component pur, aucune interactivité JS nécessaire.
 *
 * **Pas de `<title>` par point** (infobulle native SVG) : React 19 hisse
 * automatiquement tout élément `<title>` vers `<head>` comme s'il
 * s'agissait du titre du document, sans distinguer le `<title>` SVG
 * (purement décoratif ici) du `<title>` HTML de métadonnées — constaté en
 * vérification réelle : cela provoquait une erreur d'hydratation
 * (contenu du DOM serveur ≠ client) sur ce graphique précis. Un `<desc>`
 * (non hissé) n'offre pas d'infobulle native au survol ; faute d'un
 * moyen fiable d'obtenir l'un sans l'autre ici, l'infobulle par point est
 * volontairement omise plutôt que de rouvrir ce bug.
 *
 * `points` vient de `getEvolutionSoldeCaisse` — jamais de donnée
 * fictive : le dernier point de la courbe est toujours égal au solde de
 * caisse actuel affiché juste au-dessus dans le bandeau "hero".
 *
 * Conçu pour être posé sur le fond dégradé bleu foncé du bandeau "hero"
 * (voir `page.tsx`) — traits et texte en blanc/transparence, jamais les
 * couleurs de la palette utilisées sur fond clair ailleurs dans l'app.
 */
export function SoldeCaisseTrendChart({ points }: { points: PointEvolutionSoldeCaisse[] }) {
  if (points.length < 2) {
    return (
      <p className="relative mt-5 text-xs text-white/60">
        Historique de mouvements insuffisant pour tracer une tendance sur cette période.
      </p>
    );
  }

  const minDate = points[0].date.getTime();
  const maxDate = points[points.length - 1].date.getTime();
  const spanDate = Math.max(1, maxDate - minDate);

  const soldes = points.map((p) => p.solde);
  let minV = Math.min(...soldes);
  let maxV = Math.max(...soldes);
  if (minV === maxV) {
    minV -= 1;
    maxV += 1;
  } else {
    const pad = (maxV - minV) * 0.12;
    minV -= pad;
    maxV += pad;
  }

  const plotWidth = WIDTH - PAD_X * 2;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const xFor = (t: number) => PAD_X + ((t - minDate) / spanDate) * plotWidth;
  const yFor = (v: number) => PAD_TOP + (1 - (v - minV) / (maxV - minV)) * plotHeight;

  const coords = points.map((p) => [xFor(p.date.getTime()), yFor(p.solde)] as const);
  const linePath = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const base = (PAD_TOP + plotHeight).toFixed(1);
  const areaPath = `${linePath} L${coords[coords.length - 1][0].toFixed(1)},${base} L${coords[0][0].toFixed(1)},${base} Z`;

  const premier = points[0];
  const dernier = points[points.length - 1];
  const delta = dernier.solde - premier.solde;

  return (
    <div className="relative mt-5">
      <div className="mb-1.5 flex items-center justify-between text-xs text-white/70">
        <span>
          Évolution depuis le {premier.date.toLocaleDateString("fr-FR")}
        </span>
        <span className={`font-semibold tabular-nums ${delta >= 0 ? "text-white" : "text-white/90"}`}>
          {delta >= 0 ? "+" : ""}
          {delta.toLocaleString("fr-FR")} FCFA
        </span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label="Évolution du solde de caisse">
        <defs>
          <linearGradient id="soldeCaisseHeroGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#soldeCaisseHeroGradient)" />
        <path d={linePath} fill="none" stroke="#ffffff" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {coords.map(([x, y], i) => {
          const estDernier = i === coords.length - 1;
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={estDernier ? 4 : 2}
              fill={estDernier ? "#ffffff" : "rgba(255,255,255,0.6)"}
            />
          );
        })}
      </svg>
    </div>
  );
}

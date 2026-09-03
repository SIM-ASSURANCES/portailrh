export type BrandBackdropVariant = "hero" | "subtle";

export interface BrandBackdropProps {
  /** "hero" : traitement riche (page de connexion). "subtle" : très atténué, pour un fond quotidien (en-tête). */
  variant?: BrandBackdropVariant;
  className?: string;
}

/**
 * Fond de marque : dégradé diagonal bleu clair → bleu foncé avec des formes
 * triangulaires superposées en transparence, reprenant la géométrie du
 * logo lui-même — même esprit que la page de couverture de la charte
 * graphique SIM Assurances (voir CLAUDE.md "Logo et fond de marque").
 *
 * Les triangles ne sont PAS des formes inventées : leur angle au sommet
 * (~62°) reproduit celui du triangle du logo (`logo-sim-couleur.svg`,
 * silhouette englobante apex/base), agrandi et décliné en plusieurs
 * tailles/opacités pour la profondeur. Purement décoratif — `aria-hidden`,
 * jamais de contenu informatif dedans, jamais posé derrière une zone de
 * travail dense (tableaux/formulaires métier, voir CLAUDE.md).
 *
 * `variant="subtle"` divise fortement les opacités pour un usage quotidien
 * (en-tête) sans nuire à la lisibilité du contenu — jamais le même
 * traitement riche que la page de connexion (un seul "moment fort" par
 * écran, pas partout).
 *
 * Exemple :
 *   <div className="relative overflow-hidden">
 *     <BrandBackdrop variant="hero" className="absolute inset-0" />
 *     <div className="relative">...contenu...</div>
 *   </div>
 */
export function BrandBackdrop({ variant = "hero", className = "" }: BrandBackdropProps) {
  const strong = variant === "hero";

  return (
    <svg
      viewBox="0 0 800 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className={`pointer-events-none ${className}`}
    >
      <defs>
        <linearGradient id="brand-backdrop-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#51AEE2" />
          <stop offset="55%" stopColor="#0F6FC0" />
          <stop offset="100%" stopColor="#00203F" />
        </linearGradient>
      </defs>

      <rect width="800" height="600" fill="url(#brand-backdrop-gradient)" />

      {/* Triangles superposés — même angle au sommet (~62°) que le logo,
          agrandi. Empilés grand → petit pour un effet de profondeur, jamais
          pivotés au-delà d'un simple effet miroir (apex vers le bas),
          contrairement au logo lui-même qui n'est jamais retourné. */}
      <polygon points="120,650 620,650 370,120" fill="#FFFFFF" opacity={strong ? 0.07 : 0.035} />
      <polygon points="-80,600 420,600 170,70" fill="#FFFFFF" opacity={strong ? 0.05 : 0.025} />
      <polygon points="500,-40 900,640 100,640" fill="#51AEE2" opacity={strong ? 0.12 : 0.05} />
      <polygon points="640,700 980,700 810,380" fill="#FFFFFF" opacity={strong ? 0.09 : 0.04} />
      <polygon points="700,-60 1040,560 360,560" fill="#004B9C" opacity={strong ? 0.18 : 0.08} />
    </svg>
  );
}

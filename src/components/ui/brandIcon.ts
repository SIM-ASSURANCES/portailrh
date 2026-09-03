/**
 * Géométrie du pictogramme du logo SIM Assurances (triangle stylisé, sans
 * le texte "SIM ASSURANCES") — extraite du tracé vectoriel fidèle de
 * `public/logo-sim-couleur.svg`/`logo-sim-blanc.svg` (voir CLAUDE.md
 * "Logo vectoriel et fond de marque"). Source unique partagée par
 * `Sidebar.tsx` (icône de la sidebar réduite) et `BrandBackdrop.tsx`
 * (filigrane du papier à en-tête) — jamais dupliquer ce chemin ailleurs.
 */
export const BRAND_ICON_VIEWBOX = "0 0 114 94";

export const BRAND_ICON_PATHS = [
  "M56.37 0.1 L54.87 3.23 L33.28 38.54 L59 80.55 L59 81.63 L28.47 81.82 L28 82.21 L28.01 83.08 L34.17 93.1 L35.17 94 L80.63 94 L80.79 92.75 L80.24 91.79 L47.88 38.58 L56.36 24 L56.65 24 L57.81 25.03 L63.1 33.81 L64 34.83 L64.17 35.6 L73.34 50.67 L74.96 49.87 L80.99 39.72 L81 39.22 L57.97 1.35 L57 0.54 L56.83 0 Z",
  "M86.81 51.44 L81.05 60.68 L80.81 62.59 L98.35 91.63 L100.17 94 L113.15 94 L113.36 92.58 L113 91.79 L90 54.03 L87.97 50.83 L87.2 50.83 Z",
  "M25.64 51.11 L0.68 92.17 L0 92.17 L0 94 L13.83 94 L33.04 62.78 L33.2 61.58 L26.92 51.08 Z",
] as const;

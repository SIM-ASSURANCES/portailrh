import { ImageResponse } from "next/og";

import { BRAND_ICON_PATHS, BRAND_ICON_VIEWBOX } from "@/components/ui/brandIcon";

/**
 * Favicon généré à partir du pictogramme du logo SIM Assurances (le
 * triangle seul, jamais le texte "SIM ASSURANCES") — même géométrie
 * partagée que `Sidebar.tsx` (icône réduite) et `BrandBackdrop.tsx`
 * (filigrane), voir `brandIcon.ts` et CLAUDE.md "Logo vectoriel et fond de
 * marque". Convention Next.js App Router : un fichier `icon.tsx` à la
 * racine de `app/` génère l'icône via `next/og` (statiquement optimisée,
 * mise en cache au build) — remplace l'ancien `favicon.ico` par défaut du
 * scaffold (jamais personnalisé jusqu'ici), supprimé au profit de cette
 * source unique.
 */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#004B9C",
        }}
      >
        <svg width="23" height="19" viewBox={BRAND_ICON_VIEWBOX} fill="none">
          {BRAND_ICON_PATHS.map((d) => (
            <path key={d} d={d} fill="#FFFFFF" />
          ))}
        </svg>
      </div>
    ),
    { ...size }
  );
}

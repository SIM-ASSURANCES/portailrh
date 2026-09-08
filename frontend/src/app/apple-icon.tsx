import { ImageResponse } from "next/og";

import { BRAND_ICON_PATHS, BRAND_ICON_VIEWBOX } from "@/components/ui/brandIcon";

/**
 * Icône iOS ("ajouter à l'écran d'accueil") — même pictogramme et même
 * principe que `icon.tsx`, taille standard 180×180 pour les appareils
 * Apple. Pertinent pour ce portail : les collaborateurs sans ordinateur
 * pointent depuis leur téléphone (voir CLAUDE.md, coquille responsive).
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
        <svg width="128" height="106" viewBox={BRAND_ICON_VIEWBOX} fill="none">
          {BRAND_ICON_PATHS.map((d) => (
            <path key={d} d={d} fill="#FFFFFF" />
          ))}
        </svg>
      </div>
    ),
    { ...size }
  );
}

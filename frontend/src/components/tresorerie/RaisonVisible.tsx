import type { HTMLAttributes } from "react";

/**
 * Pourquoi un bouton est grisé : phrase lisible (texte foncé sur fond teinté), jamais un gris pâle que l'on ne voit
 * pas. Le texte vient du moteur du circuit (`transition`) ou en est une reformulation (`soumissionDGEcran.ts`).
 */
export function RaisonVisible({ children, className = "", ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      role="status"
      {...rest}
      className={`rounded-md border border-warning bg-warning-bg px-2.5 py-1.5 text-sm font-medium text-foreground ${className}`}
    >
      {children}
    </p>
  );
}

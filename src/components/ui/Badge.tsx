import type { ReactNode } from "react";

export type BadgeVariant = "neutral" | "info" | "success" | "warning" | "danger";

export interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
}

const variantClasses: Record<BadgeVariant, string> = {
  neutral: "bg-neutral-bg text-neutral border border-neutral-border",
  info: "bg-info-bg text-info border border-info-border",
  success: "bg-success-bg text-success border border-success-border",
  warning: "bg-warning-bg text-warning border border-warning-border",
  danger: "bg-danger-bg text-danger border border-danger-border",
};

/**
 * Étiquette de statut générique (ne connaît rien des enums métier).
 * Pour afficher un statut métier (StatutDemande, ModeReglement...), mapper
 * la valeur vers une variante via un petit objet local dans le composant
 * consommateur plutôt que d'étendre ce composant — voir l'exemple dans
 * CLAUDE.md ("Badges de statut métier").
 *
 * Exemple :
 *   <Badge variant="success">Validée</Badge>
 */
export function Badge({ variant = "neutral", children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${variantClasses[variant]}`}
    >
      {children}
    </span>
  );
}

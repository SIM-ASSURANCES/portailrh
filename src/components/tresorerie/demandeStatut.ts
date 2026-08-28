import type { BadgeVariant } from "@/components/ui";
import type { StatutDemande } from "@/generated/prisma/client";

/**
 * Mapping partagé StatutDemande -> Badge/libellé, pour rester cohérent sur
 * tous les écrans Trésorerie qui affichent un statut de demande (liste
 * "Mes demandes", liste Finance, détail de catégorisation...).
 */
export const STATUT_DEMANDE_BADGE_VARIANT: Record<StatutDemande, BadgeVariant> = {
  EN_ATTENTE: "warning",
  VALIDEE: "success",
  REJETEE: "danger",
  CLOTUREE_TOTALE: "neutral",
  CLOTUREE_PARTIELLE: "info",
};

export const STATUT_DEMANDE_LABEL: Record<StatutDemande, string> = {
  EN_ATTENTE: "En attente",
  VALIDEE: "Validée",
  REJETEE: "Rejetée",
  CLOTUREE_TOTALE: "Clôturée",
  CLOTUREE_PARTIELLE: "Clôturée (partielle)",
};

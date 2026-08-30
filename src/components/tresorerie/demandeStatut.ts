import type { BadgeVariant } from "@/components/ui";
import type { StatutDemande } from "@/generated/prisma/client";

/**
 * Mapping partagé StatutDemande -> Badge/libellé, pour rester cohérent sur
 * tous les écrans Trésorerie qui affichent un statut de demande (liste
 * "Mes demandes", liste Finance, détail de catégorisation...).
 *
 * REFONTE V1 (en cours, voir CLAUDE.md "Refonte V1 en cours") : l'enum
 * compte désormais 11 valeurs, mais la logique applicative actuelle ne
 * produit encore que EN_ATTENTE_VALIDATION / VALIDEE / REJETEE / CLOTUREE
 * (mapping temporaire de l'ancien enum, Tâche 2). Les 7 autres valeurs sont
 * posées ici avec un variant/libellé provisoire pour que l'affichage ne
 * casse pas le jour où les phases B à H commenceront à les produire — à
 * revoir précisément à ce moment-là (couleur, libellé définitif).
 */
export const STATUT_DEMANDE_BADGE_VARIANT: Record<StatutDemande, BadgeVariant> = {
  BROUILLON: "neutral",
  EN_ATTENTE_VALIDATION: "warning",
  VALIDEE: "success",
  PARTIELLEMENT_VALIDEE: "info",
  VALIDEE_NON_REGLEE: "info",
  PARTIELLEMENT_REGLEE: "info",
  REGLEE: "success",
  REJETEE: "danger",
  EN_ATTENTE_REGULARISATION: "warning",
  REGULARISEE: "success",
  CLOTUREE: "neutral",
};

export const STATUT_DEMANDE_LABEL: Record<StatutDemande, string> = {
  BROUILLON: "Brouillon",
  EN_ATTENTE_VALIDATION: "En attente de validation",
  VALIDEE: "Validée",
  PARTIELLEMENT_VALIDEE: "Partiellement validée",
  VALIDEE_NON_REGLEE: "Validée, non réglée",
  PARTIELLEMENT_REGLEE: "Partiellement réglée",
  REGLEE: "Réglée",
  REJETEE: "Rejetée",
  EN_ATTENTE_REGULARISATION: "En attente de régularisation",
  REGULARISEE: "Régularisée",
  CLOTUREE: "Clôturée",
};

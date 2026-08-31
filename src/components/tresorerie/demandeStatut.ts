import type { BadgeVariant } from "@/components/ui";
import type { StatutDemande } from "@/generated/prisma/client";

/**
 * Mapping partagé StatutDemande -> Badge/libellé, pour rester cohérent sur
 * tous les écrans Trésorerie qui affichent un statut de demande (liste
 * "Mes demandes", liste Finance, détail de catégorisation...).
 *
 * REFONTE V1 (voir CLAUDE.md "Refonte V1 en cours") : l'enum compte 11
 * valeurs. Depuis la Phase B (validation partielle/complémentaire), la
 * logique applicative produit réellement : EN_ATTENTE_VALIDATION,
 * PARTIELLEMENT_VALIDEE, VALIDEE_NON_REGLEE, PARTIELLEMENT_REGLEE, REGLEE,
 * REJETEE, CLOTUREE. `VALIDEE` n'est plus jamais produite (transitoire,
 * immédiatement remplacée par VALIDEE_NON_REGLEE — voir
 * `calculerStatutDemande`), conservée pour compatibilité. `BROUILLON`,
 * `EN_ATTENTE_REGULARISATION` et `REGULARISEE` restent posées en fondation
 * avec un variant/libellé provisoire pour les phases suivantes (règlement
 * adapté, régularisation).
 */
export const STATUT_DEMANDE_BADGE_VARIANT: Record<StatutDemande, BadgeVariant> = {
  BROUILLON: "neutral",
  EN_ATTENTE_VALIDATION: "warning",
  VALIDEE: "success",
  // "warning" plutôt que "info" : une demande partiellement validée attend
  // encore une action (validation complémentaire), contrairement aux
  // statuts "info" qui ne font qu'informer sur un état stable en cours de
  // traitement normal.
  PARTIELLEMENT_VALIDEE: "warning",
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

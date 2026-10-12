import type { BadgeVariant } from "@/components/ui";
import type { StatutJustificationPointage } from "backend";

/** Couleur du badge de statut d'une justification de pointage (Pointage V2, lot 4), partagée par tous les écrans. */
export const VARIANTE_STATUT_JUSTIFICATION: Record<StatutJustificationPointage, BadgeVariant> = {
  EN_ATTENTE: "warning",
  SOUMISE: "info",
  ACCEPTEE: "success",
  REFUSEE: "danger",
  NON_JUSTIFIEE: "danger",
};

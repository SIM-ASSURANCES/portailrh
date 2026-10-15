import type { BadgeVariant } from "@/components/ui";
import type { StatutCircuitAbsence } from "backend";

/** Variante de badge par statut (congés ET permissions d'absence : un seul vocabulaire). */
export const VARIANTE_STATUT_ABSENCE: Record<StatutCircuitAbsence, BadgeVariant> = {
  EN_ATTENTE_RESPONSABLE: "warning",
  EN_ATTENTE_RH: "warning",
  VALIDEE: "success",
  APPROUVEE: "success",
  CONSOMMEE: "neutral",
  REJETEE: "danger",
  ANNULEE: "neutral",
  MODIFICATION_DEMANDEE: "info",
};

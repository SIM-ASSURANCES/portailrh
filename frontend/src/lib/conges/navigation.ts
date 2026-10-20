import { hasPermission } from "@/lib/auth";
import { PERMISSION_DG_CONGE } from "backend";
import type { ModuleCongeNav } from "@/components/layout/nav";
import { chargerFileDecisionConges, type SessionPortail } from "@/lib/conges/lecture";

/** Entrées de menu du module Congés ; les layouts du module restent les gardes d'accès. */
export async function chargerNavConges(
  session: SessionPortail,
  estResponsableDeService: boolean
): Promise<ModuleCongeNav | null> {
  const soumettre = hasPermission(session, "conges.soumettre");
  const estRH = session.rolePermissions.includes("conges.valider_rh");
  const consulteTous = hasPermission(session, "conges.consulter_tous");
  const estDG = session.rolePermissions.includes(PERMISSION_DG_CONGE);
  const peutDecider = estResponsableDeService || estRH || estDG;
  const acces = soumettre || estRH || consulteTous || estResponsableDeService || estDG;
  if (!acces) return null;

  const file = peutDecider ? await chargerFileDecisionConges(session) : null;
  return {
    soumettre,
    aDecider: file && (file.length > 0 || estRH || estResponsableDeService) ? file.length : null,
    saisieRH: estRH,
    toutes: consulteTous || estRH || estDG,
  };
}

import { hasPermission } from "@/lib/auth";
import { PERMISSION_DG_ABSENCE } from "backend";
import type { ModuleAbsenceNav } from "@/components/layout/nav";
import { chargerFileDecisionConges, type SessionPortail } from "@/lib/conges/lecture";
import { chargerFileDecisionPermissions } from "@/lib/absences/lecture";

/**
 * Entrées de menu « Congés » et « Permissions d'absence » (Lot 5). Mêmes conditions d'accès que les layouts des deux
 * modules (`conges/layout.tsx`, `permissions-absence/layout.tsx`), qui restent la garde : ce calcul ne fait qu'afficher
 * ou non le lien. `null` = aucun accès, la branche n'apparaît pas.
 *
 * La file « à décider » n'est chargée que pour un compte qui peut décider quelque chose (responsable d'un service, RH,
 * DG) : un collaborateur ordinaire ne déclenche aucune requête supplémentaire à chaque page.
 */
export async function chargerNavAbsences(
  session: SessionPortail,
  estResponsableDeService: boolean
): Promise<{ conges: ModuleAbsenceNav | null; permissions: ModuleAbsenceNav | null }> {
  const portee = (nature: "conges" | "absences") => {
    const soumettre = hasPermission(session, `${nature}.soumettre`);
    const estRH = session.rolePermissions.includes(`${nature}.valider_rh`);
    const consulteTous = hasPermission(session, `${nature}.consulter_tous`);
    const peutDecider = estResponsableDeService || estRH || session.rolePermissions.includes(PERMISSION_DG_ABSENCE);
    return { soumettre, estRH, consulteTous, peutDecider, acces: soumettre || estRH || consulteTous };
  };
  const c = portee("conges");
  const p = portee("absences");

  const [fileConges, filePermissions] = await Promise.all([
    c.acces && c.peutDecider ? chargerFileDecisionConges(session) : Promise.resolve(null),
    p.acces && p.peutDecider ? chargerFileDecisionPermissions(session) : Promise.resolve(null),
  ]);

  return {
    conges: c.acces
      ? {
          soumettre: c.soumettre,
          aDecider: fileConges && (fileConges.length > 0 || c.estRH) ? fileConges.length : null,
          soldes: hasPermission(session, "conges.gerer_soldes") || c.consulteTous || c.estRH,
        }
      : null,
    permissions: p.acces
      ? {
          soumettre: p.soumettre,
          aDecider: filePermissions && (filePermissions.length > 0 || p.estRH) ? filePermissions.length : null,
          soldes: false,
        }
      : null,
  };
}

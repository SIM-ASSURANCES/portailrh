import { hasPermission } from "@/lib/auth";

type Session = Parameters<typeof hasPermission>[0];

/**
 * Lecture de la rémunération des partenaires (Q10, registre C-36) : commissions, accessoires reversés, honoraires, conventions
 * et règlements. UNE seule règle, utilisée par chaque page, export, PDF et action qui en montre : consulter le module ET
 * `cpt.consulter_remuneration`. Les permissions d'écriture (régler, compenser, gérer les conventions) ne l'impliquent pas.
 */
export function peutVoirRemunerationCpt(session: Session): boolean {
  return hasPermission(session, "cpt.consulter") && hasPermission(session, "cpt.consulter_remuneration");
}

import { redirect } from "next/navigation";

import { getSession, hasPermission } from "@/lib/auth";
import { PERMISSION_DG_ABSENCE, prisma } from "backend";
import { chargerFileDecisionPermissions } from "@/lib/absences/lecture";
import { SousNavConges, type LienSousNav } from "../conges/SousNavConges";

/**
 * Module Permissions d'absence. Chaque page revérifie elle-même ce dont elle a besoin ; ce layout ne fait que garder la
 * session et construire la sous-navigation (jamais une garde suffisante à elle seule).
 */
export default async function PermissionsAbsenceLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const estRH = session.rolePermissions.includes("absences.valider_rh");
  const peutSoumettre = hasPermission(session, "absences.soumettre");
  const consulteTous = hasPermission(session, "absences.consulter_tous");
  // Responsable actuel d'au moins un service : accès à « À décider » seulement (voir le layout des congés).
  const estResponsable = (await prisma.service.count({ where: { responsableId: session.user.id } })) > 0;
  // Le DG voit toutes les demandes sans `consulter_tous` (C3) : sa permission d'étape, lue sur le RÔLE.
  const estDG = session.rolePermissions.includes(PERMISSION_DG_ABSENCE);
  if (!peutSoumettre && !estRH && !consulteTous && !estResponsable && !estDG) redirect("/?error=acces_refuse_absences");

  const file = await chargerFileDecisionPermissions(session);

  const liens: LienSousNav[] = [];
  if (peutSoumettre) {
    liens.push({ href: "/permissions-absence", label: "Mes permissions" });
    liens.push({ href: "/permissions-absence/nouvelle", label: "Nouvelle demande" });
  }
  if (file.length > 0 || estRH || estResponsable) liens.push({ href: "/permissions-absence/a-decider", label: "À décider", compteur: file.length });
  if (consulteTous || estRH || estDG) liens.push({ href: "/permissions-absence/toutes", label: "Toutes les demandes" });
  if (hasPermission(session, "absences.parametrer")) liens.push({ href: "/permissions-absence/parametrage", label: "Types de permission" });

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      {liens.length > 1 ? <SousNavConges liens={liens} racine="/permissions-absence" libelle="Permissions d'absence" /> : null}
      {children}
    </div>
  );
}

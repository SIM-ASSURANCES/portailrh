import { redirect } from "next/navigation";

import { getSession, hasPermission } from "@/lib/auth";
import { PERMISSION_DG_CONGE, prisma } from "backend";
import { chargerFileDecisionConges } from "@/lib/conges/lecture";
import { SousNavConges, type LienSousNav } from "./SousNavConges";

/**
 * Module Congés. Chaque page revérifie elle-même ce dont elle a besoin ; ce layout ne fait que garder la session et
 * construire la sous-navigation (jamais une garde suffisante à elle seule).
 */
export default async function CongesLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const estRH = session.rolePermissions.includes("conges.valider_rh");
  const estDG = session.rolePermissions.includes(PERMISSION_DG_CONGE);
  const peutSoumettre = hasPermission(session, "conges.soumettre");
  const consulteTous = hasPermission(session, "conges.consulter_tous");
  // Le responsable ACTUEL d'au moins un service décide les demandes de son service sans aucune permission (comme « Mon service »
  // en Trésorerie) : il n'accède qu'à « À décider » et au détail des demandes de son service, jamais à « Mes congés ».
  const estResponsable = (await prisma.service.count({ where: { responsableId: session.user.id } })) > 0;
  const peutDecider = estResponsable || estRH || estDG;
  if (!peutSoumettre && !estRH && !consulteTous && !estResponsable && !estDG) redirect("/?error=acces_refuse_conges");

  // La file n'est chargée que pour qui peut décider quelque chose (responsable de service, RH, DG).
  const file = peutDecider ? await chargerFileDecisionConges(session) : [];

  const liens: LienSousNav[] = [];
  if (peutSoumettre) {
    liens.push({ href: "/conges", label: "Mes congés" });
    liens.push({ href: "/conges/nouvelle", label: "Nouvelle demande" });
  }
  if (file.length > 0 || estRH || estResponsable) liens.push({ href: "/conges/a-decider", label: "À décider", compteur: file.length });
  if (consulteTous || estRH) liens.push({ href: "/conges/toutes", label: "Toutes les demandes" });
  if (estRH) liens.push({ href: "/conges/saisie-rh", label: "Saisir un congé" });

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      {liens.length > 1 ? <SousNavConges liens={liens} /> : null}
      {children}
    </div>
  );
}

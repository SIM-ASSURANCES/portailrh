import { redirect } from "next/navigation";

import { getSession, hasPermission } from "@/lib/auth";
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
  const peutSoumettre = hasPermission(session, "conges.soumettre");
  const consulteTous = hasPermission(session, "conges.consulter_tous");
  if (!peutSoumettre && !estRH && !consulteTous) redirect("/?error=acces_refuse_conges");

  // La file n'est chargée que pour qui peut décider quelque chose (responsable de service, RH, DG).
  const file = await chargerFileDecisionConges(session);

  const liens: LienSousNav[] = [];
  if (peutSoumettre) {
    liens.push({ href: "/conges", label: "Mes congés" });
    liens.push({ href: "/conges/nouvelle", label: "Nouvelle demande" });
  }
  if (file.length > 0 || estRH) liens.push({ href: "/conges/a-decider", label: "À décider", compteur: file.length });
  if (hasPermission(session, "conges.gerer_soldes") || consulteTous || estRH) liens.push({ href: "/conges/soldes", label: "Soldes" });
  if (hasPermission(session, "conges.parametrer_types")) liens.push({ href: "/conges/parametrage", label: "Types de congé" });

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      {liens.length > 1 ? <SousNavConges liens={liens} /> : null}
      {children}
    </div>
  );
}

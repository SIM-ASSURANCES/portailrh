import { redirect } from "next/navigation";
import { getSession, hasPermission } from "@/lib/auth";

/**
 * Layout protégé pour l'espace RH du Pointage.
 * Vérifie que l'utilisateur a au moins une permission RH avant de permettre l'accès.
 */
export default async function PointageRHLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  
  if (!session) {
    redirect("/login");
  }

  // Vérifier si l'utilisateur a au moins UNE permission RH
  const hasRHAccess =
    hasPermission(session, "pointage.consulter_tous") ||
    hasPermission(session, "pointage.pointage_exceptionnel") ||
    hasPermission(session, "pointage.corriger_pointage") ||
    hasPermission(session, "pointage.gerer_horaires") ||
    hasPermission(session, "pointage.voir_dashboard_rh") ||
    hasPermission(session, "pointage.voir_reporting");

  if (!hasRHAccess) {
    redirect("/pointage/pointer?error=acces_refuse_pointage_rh");
  }

  return children;
}

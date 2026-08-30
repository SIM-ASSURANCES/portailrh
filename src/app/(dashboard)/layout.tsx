import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/AppShell";
import { getSession, hasPermission, isAdmin } from "@/lib/auth";

/**
 * Layout du Socle Portail (écrans authentifiés). Toute route de ce groupe
 * hérite de la coquille applicative (sidebar + topbar) et exige une session
 * valide — redirection vers /login sinon.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <AppShell
      user={session.user}
      role={session.role}
      canAdmin={isAdmin(session)}
      canAccesFinanceDemandes={
        hasPermission(session, "treso.categoriser_demande") ||
        hasPermission(session, "treso.valider_demande")
      }
      canReceptionnerRetour={hasPermission(session, "treso.receptionner_retour")}
      canVoirDashboardFinance={hasPermission(session, "treso.voir_dashboard_finance")}
      canVoirReporting={hasPermission(session, "treso.voir_reporting")}
      canSaisirDepenseDirecte={hasPermission(session, "treso.saisir_depense_directe")}
    >
      {children}
    </AppShell>
  );
}

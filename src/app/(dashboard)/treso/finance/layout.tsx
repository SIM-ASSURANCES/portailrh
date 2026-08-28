import { redirect } from "next/navigation";

import { getSession, hasPermission } from "@/lib/auth";

/**
 * Garde d'accès de tout l'espace Finance de Trésorerie (catégorisation des
 * demandes, et futurs écrans Finance : règlements, reporting...). Réservée
 * à `treso.categoriser_demande`. Même pattern que
 * `(dashboard)/admin/layout.tsx` : redirection vers le dashboard avec un
 * toast d'erreur plutôt qu'une page 403.
 */
export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.categoriser_demande")) {
    redirect("/?error=acces_refuse_categoriser");
  }

  return <>{children}</>;
}

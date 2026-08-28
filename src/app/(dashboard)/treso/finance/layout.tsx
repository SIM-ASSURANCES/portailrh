import { redirect } from "next/navigation";

import { getSession, hasPermission } from "@/lib/auth";

/**
 * Garde d'accès de tout l'espace Finance de Trésorerie (catégorisation des
 * demandes, validation/rejet, réception des retours de caisse, dashboard
 * Finance et ses listes filtrées, et futurs écrans : reporting...).
 *
 * Accessible avec `treso.categoriser_demande` **OU** `treso.valider_demande`
 * **OU** `treso.receptionner_retour` **OU** `treso.voir_dashboard_finance`
 * (pas besoin des quatre) : Finance catégorise et réceptionne les retours
 * (généralement sans `valider_demande`), le DG valide/rejette et voit le
 * dashboard (généralement sans les deux autres, cf. seed) — ces profils
 * partagent cet espace, mais les pages qu'il contient doivent ensuite
 * afficher des actions différentes selon la permission précise de
 * l'utilisateur (voir `finance/demandes/[id]/page.tsx` et
 * `finance/retours/page.tsx`) : ne jamais supposer qu'un utilisateur qui a
 * passé cette garde a les QUATRE permissions. Dans le seed actuel, le rôle
 * Finance les a toutes les quatre, mais la garde reste correcte par
 * principe pour tout futur rôle qui n'en aurait qu'une seule.
 *
 * Même pattern que `(dashboard)/admin/layout.tsx` : redirection vers le
 * dashboard avec un toast d'erreur plutôt qu'une page 403.
 */
export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const canAccess =
    !!session &&
    (hasPermission(session, "treso.categoriser_demande") ||
      hasPermission(session, "treso.valider_demande") ||
      hasPermission(session, "treso.receptionner_retour") ||
      hasPermission(session, "treso.voir_dashboard_finance"));

  if (!canAccess) {
    redirect("/?error=acces_refuse_categoriser");
  }

  return <>{children}</>;
}

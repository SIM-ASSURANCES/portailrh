import { redirect } from "next/navigation";

import { getSession, hasPermission } from "@/lib/auth";

/**
 * Garde d'accès de tout l'espace Finance de Trésorerie (catégorisation des
 * demandes, validation/rejet, et futurs écrans : règlements, reporting...).
 *
 * Accessible avec `treso.categoriser_demande` **OU** `treso.valider_demande`
 * (pas besoin des deux) : Finance catégorise (généralement sans
 * `valider_demande`), le DG valide/rejette (généralement sans
 * `categoriser_demande`, cf. seed) — les deux profils partagent cet espace,
 * mais les pages qu'il contient doivent ensuite afficher des actions
 * différentes selon la permission précise de l'utilisateur (voir
 * `finance/demandes/[id]/page.tsx`) : ne jamais supposer qu'un utilisateur
 * qui a passé cette garde a les DEUX permissions.
 *
 * Même pattern que `(dashboard)/admin/layout.tsx` : redirection vers le
 * dashboard avec un toast d'erreur plutôt qu'une page 403.
 */
export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const canAccess =
    !!session &&
    (hasPermission(session, "treso.categoriser_demande") ||
      hasPermission(session, "treso.valider_demande"));

  if (!canAccess) {
    redirect("/?error=acces_refuse_categoriser");
  }

  return <>{children}</>;
}

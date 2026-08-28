import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader, StatCard } from "@/components/ui";
import { getDecaissementsARegulariser, getDemandesADecaisser, getRetoursEnAttente } from "@/lib/dashboardFinance";
import { getSession, hasPermission } from "@/lib/auth";
import { getSoldeCaisse } from "@/lib/tresorerie";

/**
 * Tableau de bord Finance (Ticket 8) — 4 indicateurs recalculés en temps
 * réel à chaque chargement (aucune mise en cache applicative, uniquement
 * `fetch` par défaut de Next.js déjà désactivé pour Prisma) : le solde de
 * caisse, les demandes encore à décaisser, les décaissements en attente de
 * régularisation/clôture, et les retours de caisse en attente de
 * réception. Écran d'atterrissage naturel de Finance/DG.
 *
 * Icônes et tons repris du bloc indicatif déjà présent sur le tableau de
 * bord général (`(dashboard)/page.tsx`, commentaire "valeurs indicatives
 * tant que le module Trésorerie n'est pas câblé") — ce bloc préfigurait
 * exactement cet écran (mêmes libellés/icônes pour "Retours de caisse en
 * attente"). Ce placeholder général reste en l'état pour l'instant (hors
 * périmètre de ce ticket) ; le câbler sur ces mêmes fonctions, ou le
 * retirer au profit d'un lien vers ce dashboard, est une suite naturelle.
 *
 * Protégée par `treso.voir_dashboard_finance`, revérifiée ici même si le
 * layout Finance partagé l'accepte déjà parmi ses permissions valables —
 * jamais supposée acquise du simple fait d'avoir passé la garde du layout.
 */
export default async function DashboardFinancePage() {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.voir_dashboard_finance")) {
    redirect("/?error=acces_refuse_dashboard_finance");
  }

  const [solde, aDecaisser, aRegulariser, retoursEnAttente] = await Promise.all([
    getSoldeCaisse(),
    getDemandesADecaisser(),
    getDecaissementsARegulariser(),
    getRetoursEnAttente(),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Tableau de bord Finance"
        description="Vue d'ensemble de la trésorerie, recalculée en temps réel."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon="wallet"
          tone="success"
          label="Solde de caisse"
          value={`${solde.toLocaleString("fr-FR")} FCFA`}
        />
        <Link href="/treso/finance/a-decaisser" className="block">
          <StatCard
            icon="file-text"
            tone="info"
            label="Demandes à décaisser"
            value={aDecaisser.nombre}
            hint={`${aDecaisser.montant.toLocaleString("fr-FR")} FCFA`}
          />
        </Link>
        <Link href="/treso/finance/a-regulariser" className="block">
          <StatCard
            icon="book-text"
            tone="neutral"
            label="Décaissements à régulariser"
            value={aRegulariser.nombre}
            hint={`${aRegulariser.montant.toLocaleString("fr-FR")} FCFA`}
          />
        </Link>
        <Link href="/treso/finance/retours" className="block">
          <StatCard
            icon="rotate-ccw"
            tone="warning"
            label="Retours de caisse en attente"
            value={retoursEnAttente.nombre}
          />
        </Link>
      </div>
    </div>
  );
}

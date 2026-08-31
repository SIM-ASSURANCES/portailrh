import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { FondsARegulariserTable } from "./FondsARegulariserTable";

/**
 * "Fonds remis à régulariser" (Phase G, cahier des charges section 12) —
 * règlements CAISSE confirmés et non annulés dont le solde à régulariser
 * (montant réglé − dépenses déclarées − retours reçus) n'est pas nul.
 * Cible de l'indicateur #4 de la zone "À traiter" du dashboard Finance :
 * même définition exacte que `getFondsRemisARegulariser`
 * (`dashboardFinance.ts`), redétaillée ici ligne par ligne
 * (dépenses/retours/solde), plutôt qu'une seule requête par règlement.
 *
 * "Voir la demande" renvoie au détail de la demande, où Finance retrouve
 * le règlement, la section Retours de caisse et l'historique complet —
 * aucun écran dédié "par règlement" n'existe encore dans le portail, la
 * demande reste le point d'entrée naturel pour agir (réceptionner un
 * retour se fait depuis `/treso/finance/retours`, indicateur #5 distinct).
 */
export default async function FondsARegulariserPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.voir_dashboard_finance")) {
    redirect("/?error=acces_refuse_dashboard_finance");
  }

  const reglements = await prisma.reglement.findMany({
    where: { mode: "CAISSE", estConfirme: true, estAnnule: false },
    include: {
      demande: { select: { id: true, reference: true } },
      retours: { select: { estReceptionne: true, montantARetourner: true, depenses: { select: { montant: true } } } },
    },
    orderBy: { confirmeAt: "asc" },
  });

  const rows = reglements
    .map((r) => {
      const depensesDeclarees = r.retours.reduce(
        (sum, retour) => sum + retour.depenses.reduce((s, d) => s + Number(d.montant), 0),
        0
      );
      const retoursRecus = r.retours
        .filter((retour) => retour.estReceptionne)
        .reduce((sum, retour) => sum + Number(retour.montantARetourner), 0);
      const solde = Number(r.montant) - depensesDeclarees - retoursRecus;
      return {
        id: r.id,
        demandeId: r.demande.id,
        demandeReference: r.demande.reference,
        montantReglement: Number(r.montant),
        depensesDeclarees,
        retoursRecus,
        solde,
      };
    })
    .filter((r) => r.solde !== 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Fonds remis à régulariser"
        description="Règlements Caisse dont les dépenses déclarées et retours reçus ne couvrent pas encore le montant réglé."
      />
      <FondsARegulariserTable reglements={rows} />
    </div>
  );
}

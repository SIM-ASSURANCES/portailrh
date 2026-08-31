import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSoldesARegulariserParReglements } from "@/lib/tresorerie";

import { DepensesNonJustifieesTable } from "./DepensesNonJustifieesTable";

/**
 * "Dépenses non justifiées à suivre" (Phase G, cahier des charges section
 * 12) — lignes de dépenses (`DepenseLigne`) déclarées sans pièce
 * justificative (`justification = SANS_PIECE`) dont le règlement Caisse
 * d'origine n'est pas encore totalement régularisé. Cible de l'indicateur
 * #6 de la zone "À traiter" du dashboard Finance : même définition exacte
 * que `getDepensesNonJustifiees` (`dashboardFinance.ts`).
 *
 * Une fois le règlement intégralement justifié/retourné (solde à
 * régulariser = 0), une ligne non justifiée qu'il contenait n'apparaît
 * plus ici : l'écart global est soldé, ce n'est plus un point à suivre
 * activement — même si la ligne elle-même reste, historiquement, sans
 * pièce (rien ne réécrit `DepenseLigne` après coup).
 */
export default async function DepensesNonJustifieesPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.voir_dashboard_finance")) {
    redirect("/?error=acces_refuse_dashboard_finance");
  }

  const lignes = await prisma.depenseLigne.findMany({
    where: { justification: "SANS_PIECE" },
    include: {
      retourCaisse: {
        select: { reglementId: true, reglement: { select: { demande: { select: { id: true, reference: true } } } } },
      },
    },
    orderBy: { date: "asc" },
  });

  if (lignes.length === 0) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
        <PageHeader
          title="Dépenses non justifiées à suivre"
          description="Lignes de dépenses sans pièce justificative dont le règlement d'origine n'est pas encore régularisé."
        />
        <DepensesNonJustifieesTable lignes={[]} />
      </div>
    );
  }

  const reglementIds = Array.from(new Set(lignes.map((l) => l.retourCaisse.reglementId)));
  const soldes = await getSoldesARegulariserParReglements(reglementIds);

  const rows = lignes
    .map((l) => ({
      id: l.id,
      demandeId: l.retourCaisse.reglement.demande.id,
      demandeReference: l.retourCaisse.reglement.demande.reference,
      objet: l.objet,
      montant: Number(l.montant),
      date: l.date,
      commentaire: l.commentaire,
      solde: soldes.get(l.retourCaisse.reglementId) ?? 0,
    }))
    .filter((l) => l.solde !== 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Dépenses non justifiées à suivre"
        description="Lignes de dépenses sans pièce justificative dont le règlement d'origine n'est pas encore régularisé."
      />
      <DepensesNonJustifieesTable lignes={rows} />
    </div>
  );
}

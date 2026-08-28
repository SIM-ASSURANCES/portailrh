import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { getEcart } from "@/lib/tresorerie";
import { prisma } from "@/lib/prisma";

import { ARegulariserTable } from "./ARegulariserTable";

/**
 * "Décaissements à régulariser" — demandes `VALIDEE` entièrement décaissées
 * (reste à régler = 0) mais pas encore clôturées, triées par ancienneté de
 * validation croissante. Cible du clic sur l'indicateur du même nom du
 * dashboard (Ticket 8) : même définition exacte (reste à régler = 0).
 *
 * L'écart par demande (`getEcart`, Ticket 7) est calculé demande par
 * demande (`Promise.all`), contrairement au dashboard qui agrège le
 * montant décaissé en une seule requête groupée : cet ensemble est par
 * nature une file d'attente opérationnelle bornée (demandes déjà
 * entièrement réglées en attente de clôture), son volume reste modeste
 * même pour une application interne active — pas besoin d'une requête SQL
 * brute pour grouper des retours par demande via leur règlement.
 */
export default async function ARegulariserPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.voir_dashboard_finance")) {
    redirect("/?error=acces_refuse_dashboard_finance");
  }

  const demandes = await prisma.demande.findMany({
    where: { statut: "VALIDEE" },
    include: { createur: true },
    orderBy: { updatedAt: "asc" },
  });

  const ids = demandes.map((d) => d.id);
  const sommes = await prisma.reglement.groupBy({
    by: ["demandeId"],
    where: { demandeId: { in: ids }, estConfirme: true, estAnnule: false },
    _sum: { montant: true },
  });
  const totalRegleParDemande = new Map(sommes.map((s) => [s.demandeId, Number(s._sum.montant ?? 0)]));

  const aRegulariser = demandes
    .map((d) => {
      const montant = Number(d.montant);
      const totalRegle = totalRegleParDemande.get(d.id) ?? 0;
      const reste = Math.max(0, montant - totalRegle);
      return {
        id: d.id,
        reference: d.reference,
        createurNom: d.createur.fullName,
        totalRegle,
        valideeLe: d.updatedAt,
        reste,
      };
    })
    .filter((d) => d.reste === 0);

  const rows = await Promise.all(
    aRegulariser.map(async (d) => ({
      id: d.id,
      reference: d.reference,
      createurNom: d.createurNom,
      totalRegle: d.totalRegle,
      valideeLe: d.valideeLe,
      ecart: await getEcart(d.id),
    }))
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Décaissements à régulariser"
        description="Demandes entièrement réglées, en attente de clôture. Triées par ancienneté de validation."
      />
      <ARegulariserTable demandes={rows} />
    </div>
  );
}

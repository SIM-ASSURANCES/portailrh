import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { getEcart } from "@/lib/tresorerie";
import { prisma } from "@/lib/prisma";

import { ARegulariserTable } from "./ARegulariserTable";

/**
 * "Décaissements à régulariser" — demandes ENTIÈREMENT validées et
 * entièrement décaissées (reste à régler = 0, calculé sur `montantValide`)
 * mais pas encore clôturées, triées par ancienneté de validation
 * croissante. Cible du clic sur l'indicateur du même nom du dashboard
 * (Ticket 8) : même définition exacte, calculée en 2 requêtes groupées
 * plutôt qu'une par demande (voir `dashboardFinance.ts`).
 *
 * REFONTE V1 / Phase C (voir CLAUDE.md "Refonte V1 en cours") : une demande
 * seulement `PARTIELLEMENT_VALIDEE` dont la part déjà validée est
 * intégralement réglée n'apparaît PAS ici (exige en plus
 * `montantValide >= montant demandé`) — elle n'est pas encore prête pour la
 * clôture puisqu'un reliquat reste à valider (et pourrait ensuite être
 * réglé à son tour). Voir `getRepartitionDemandesValidees` dans
 * `dashboardFinance.ts`, qui applique exactement la même règle pour le KPI
 * du dashboard.
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
    where: { montantValide: { gt: 0 }, statut: { notIn: ["REJETEE", "CLOTUREE"] } },
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
      const montantValide = Number(d.montantValide);
      const totalRegle = totalRegleParDemande.get(d.id) ?? 0;
      const reste = Math.max(0, montantValide - totalRegle);
      const estEntierementValidee = montantValide >= Number(d.montant);
      return {
        id: d.id,
        reference: d.reference,
        createurNom: d.createur.fullName,
        totalRegle,
        valideeLe: d.updatedAt,
        reste,
        estEntierementValidee,
      };
    })
    .filter((d) => d.reste === 0 && d.estEntierementValidee);

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

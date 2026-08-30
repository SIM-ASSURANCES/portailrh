import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { ReglementsPartielsTable } from "./ReglementsPartielsTable";

/**
 * "Règlements partiels à compléter" (Phase G, cahier des charges section
 * 12) — demandes ayant un montant validé déjà PARTIELLEMENT réglé
 * (`getTotalRegle > 0`) mais pas terminé (`getResteARegler > 0`), triées
 * par ancienneté de validation croissante. Cible de l'indicateur #3 de la
 * zone "À traiter" du dashboard Finance : même définition exacte que
 * `getReglementsPartielsACompleter` (`dashboardFinance.ts`), calculée en 2
 * requêtes groupées plutôt qu'une par demande.
 *
 * Complémentaire de `/treso/finance/a-decaisser` (indicateur #2, "rien
 * réglé encore") — chaque demande éligible au règlement (montant validé
 * avec un reste > 0) apparaît dans EXACTEMENT une seule de ces deux
 * listes, jamais les deux (`totalRegle === 0` vs `totalRegle > 0` sont
 * mutuellement exclusifs).
 */
export default async function ReglementsPartielsPage() {
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

  const rows = demandes
    .map((d) => {
      const montantValide = Number(d.montantValide);
      const totalRegle = totalRegleParDemande.get(d.id) ?? 0;
      const reste = Math.max(0, montantValide - totalRegle);
      return {
        id: d.id,
        reference: d.reference,
        createurNom: d.createur.fullName,
        montantValide,
        totalRegle,
        reste,
        valideeLe: d.updatedAt,
      };
    })
    .filter((d) => d.reste > 0 && d.totalRegle > 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Règlements partiels à compléter"
        description="Demandes déjà partiellement réglées, dont le règlement n'est pas terminé. Triées par ancienneté de validation."
      />
      <ReglementsPartielsTable demandes={rows} />
    </div>
  );
}

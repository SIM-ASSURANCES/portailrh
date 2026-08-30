import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { ADecaisserTable } from "./ADecaisserTable";

/**
 * "Demandes à décaisser" — demandes ayant un montant validé dont il reste
 * quelque chose à régler, triées par ancienneté de validation croissante
 * (les plus anciennes en premier, même convention que les autres files
 * d'attente Finance). Cible du clic sur l'indicateur du même nom du
 * dashboard (Ticket 8) : même définition exacte (reste à régler > 0),
 * calculée en 2 requêtes groupées plutôt qu'une par demande (voir
 * `dashboardFinance.ts`).
 *
 * REFONTE V1 / Phase C (voir CLAUDE.md "Refonte V1 en cours") : la sélection
 * et le calcul du reste se basent sur `montantValide`, pas le statut
 * (`STATUTS_VALIDATION_COMPLETE`, Phase B) ni le montant demandé — une
 * demande `PARTIELLEMENT_VALIDEE` apparaît donc ici dès que son montant
 * validé dépasse ce qui est déjà réglé (cahier des charges section 4).
 */
export default async function ADecaisserPage() {
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
        reste,
        valideeLe: d.updatedAt,
      };
    })
    .filter((d) => d.reste > 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Demandes à décaisser"
        description="Demandes validées dont le règlement n'est pas terminé. Triées par ancienneté de validation."
      />
      <ADecaisserTable demandes={rows} />
    </div>
  );
}

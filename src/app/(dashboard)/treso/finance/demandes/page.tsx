import { PageHeader } from "@/components/ui";
import { getBeneficiaireNom } from "@/components/tresorerie/beneficiaire";
import { prisma } from "@/lib/prisma";

import { DemandesACategoriserTable } from "./DemandesACategoriserTable";

/**
 * "Demandes en attente de validation" — cible de l'indicateur #1 de la
 * zone "À traiter" du dashboard Finance (Phase G, cahier des charges
 * section 12). Inclut `EN_ATTENTE_VALIDATION` (rien validé) ET
 * `PARTIELLEMENT_VALIDEE` (un reliquat non validé subsiste — même
 * définition exacte que `getDemandesEnAttenteValidation`,
 * `dashboardFinance.ts`) : cette dernière n'était pas incluse avant la
 * Phase G, alors qu'une demande partiellement validée reste, par
 * définition, "en attente de validation" pour sa partie non validée.
 */
export default async function FinanceDemandesPage() {
  const rawDemandes = await prisma.demande.findMany({
    where: { statut: { in: ["EN_ATTENTE_VALIDATION", "PARTIELLEMENT_VALIDEE"] } },
    include: { createur: true, beneficiaireUser: true },
    orderBy: { createdAt: "asc" },
  });

  const demandes = rawDemandes.map((d) => ({
    id: d.id,
    reference: d.reference,
    createurNom: d.createur.fullName,
    beneficiaireNom: getBeneficiaireNom(d),
    montant: Number(d.montant),
    description: d.description,
    createdAt: d.createdAt,
    statut: d.statut,
    typeDemande: d.typeDemande,
    natureDepenseDirecte: d.natureDepenseDirecte,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Demandes en attente de validation"
        description="Demandes non validées ou partiellement validées, triées par ancienneté : les plus anciennes en premier."
      />
      <DemandesACategoriserTable demandes={demandes} />
    </div>
  );
}

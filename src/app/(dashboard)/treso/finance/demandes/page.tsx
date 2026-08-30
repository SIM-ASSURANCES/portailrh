import { PageHeader } from "@/components/ui";
import { prisma } from "@/lib/prisma";

import { DemandesACategoriserTable } from "./DemandesACategoriserTable";

export default async function FinanceDemandesPage() {
  const rawDemandes = await prisma.demande.findMany({
    where: { statut: "EN_ATTENTE_VALIDATION" },
    include: { createur: true },
    orderBy: { createdAt: "asc" },
  });

  const demandes = rawDemandes.map((d) => ({
    id: d.id,
    reference: d.reference,
    createurNom: d.createur.fullName,
    montant: Number(d.montant),
    description: d.description,
    createdAt: d.createdAt,
    statut: d.statut,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Demandes à catégoriser"
        description="Demandes en attente, triées par ancienneté : les plus anciennes en premier."
      />
      <DemandesACategoriserTable demandes={demandes} />
    </div>
  );
}

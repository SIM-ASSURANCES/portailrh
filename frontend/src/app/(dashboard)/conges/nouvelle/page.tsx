import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { aujourdhui } from "@/lib/conges/format";
import { prisma } from "backend";

import { DemandeCongeForm } from "../DemandeCongeForm";

export default async function NouvelleDemandeCongePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "conges.soumettre")) redirect("/?error=acces_refuse_conges");

  const types = await prisma.typeConge.findMany({ where: { isActive: true }, orderBy: [{ categorie: "asc" }, { label: "asc" }] });

  return (
    <div className="space-y-6">
      <PageHeader title="Nouvelle demande de congé" description="Votre responsable de service examine d'abord votre demande, puis la RH la valide." />
      <DemandeCongeForm
        mode="nouvelle"
        aujourdhui={aujourdhui()}
        types={types.map((t) => ({
          id: t.id,
          label: t.label,
          categorie: t.categorie,
          nbJoursDefaut: t.nbJoursDefaut,
          decompteType: t.decompteType,
          justificatifObligatoire: t.justificatifObligatoire,
          nonDeductibleSolde: t.nonDeductibleSolde,
          ancienneteMinimumMois: t.ancienneteMinimumMois,
        }))}
      />
    </div>
  );
}

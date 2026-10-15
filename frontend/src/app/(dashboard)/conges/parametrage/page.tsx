import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "backend";

import { TypesCongeGestion } from "./TypesCongeGestion";

export default async function ParametrageCongesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "conges.parametrer_types")) redirect("/?error=acces_refuse_conges");

  const types = await prisma.typeConge.findMany({ orderBy: [{ categorie: "asc" }, { label: "asc" }] });

  return (
    <div className="space-y-6">
      <PageHeader title="Types de congé" description="Durées, décompte, ancienneté et pièces exigées. Un type désactivé n'est plus proposé, les demandes existantes sont conservées." />
      <TypesCongeGestion types={types.map(({ id, code, label, categorie, nbJoursDefaut, decompteType, justificatifObligatoire, nonDeductibleSolde, ancienneteMinimumMois, isActive }) => ({ id, code, label, categorie, nbJoursDefaut, decompteType, justificatifObligatoire, nonDeductibleSolde, ancienneteMinimumMois, isActive }))} />
    </div>
  );
}

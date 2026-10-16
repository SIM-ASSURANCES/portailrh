import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "backend";

import { TypesPermissionGestion } from "./TypesPermissionGestion";

export default async function ParametragePermissionsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "absences.parametrer")) redirect("/?error=acces_refuse_absences");

  const types = await prisma.typePermission.findMany({ orderBy: { label: "asc" } });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Types de permission"
        description="Durée maximale d'une permission et nombre autorisé par mois et par collaborateur. Un type désactivé n'est plus proposé, les demandes existantes sont conservées."
      />
      <TypesPermissionGestion types={types.map(({ id, label, dureeMaxHeures, plafondMensuel, justificatifRecommande, isActive }) => ({ id, label, dureeMaxHeures, plafondMensuel, justificatifRecommande, isActive }))} />
    </div>
  );
}

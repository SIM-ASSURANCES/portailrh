import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { aujourdhui } from "@/lib/conges/format";
import { prisma } from "backend";

import { DemandePermissionForm } from "./DemandePermissionForm";

export default async function NouvellePermissionPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "absences.soumettre")) redirect("/?error=acces_refuse_absences");

  const types = await prisma.typePermission.findMany({ where: { isActive: true }, orderBy: { label: "asc" } });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nouvelle permission d'absence"
        description="Absence de quelques heures sur une journée de travail. Votre responsable de service examine d'abord la demande, puis la RH l'approuve."
      />
      <DemandePermissionForm
        aujourdhui={aujourdhui()}
        types={types.map((t) => ({ id: t.id, label: t.label, dureeMaxHeures: t.dureeMaxHeures, plafondMensuel: t.plafondMensuel }))}
      />
    </div>
  );
}

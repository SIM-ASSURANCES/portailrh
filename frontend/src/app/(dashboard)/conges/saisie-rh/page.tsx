import { redirect } from "next/navigation";

import { EmptyState, PageHeader } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { aujourdhui } from "@/lib/conges/format";
import { PERMISSION_ETAPE_RH_CONGE, prisma } from "backend";

import { DemandeCongeForm } from "../DemandeCongeForm";

export default async function SaisieRHCongePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.rolePermissions.includes(PERMISSION_ETAPE_RH_CONGE)) {
    redirect("/?error=acces_refuse_conges");
  }

  const salaries = await prisma.user.findMany({
    where: { isActive: true, id: { not: session.user.id } },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Saisir un congé"
        description="Enregistrez un congé déjà validé pour un autre salarié actif."
      />
      {salaries.length === 0 ? (
        <EmptyState icon="users" message="Aucun autre salarié actif ne peut être sélectionné." />
      ) : (
        <DemandeCongeForm aujourdhui={aujourdhui()} saisieRH salaries={salaries} />
      )}
    </div>
  );
}

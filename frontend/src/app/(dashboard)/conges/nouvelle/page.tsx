import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { aujourdhui } from "@/lib/conges/format";
import { prisma } from "backend";

import { DemandeCongeForm } from "../DemandeCongeForm";

export default async function NouvelleDemandeCongePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "conges.soumettre")) {
    const estResponsable = await prisma.service.count({ where: { responsableId: session.user.id } });
    redirect(estResponsable > 0 ? "/conges/a-decider" : "/?error=acces_refuse_conges");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nouvelle demande de congé"
        description="Votre responsable de service examine d’abord la demande, puis la RH prend la décision finale."
      />
      <DemandeCongeForm aujourdhui={aujourdhui()} />
    </div>
  );
}

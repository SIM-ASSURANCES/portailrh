import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui";
import { HorairesForm } from "./HorairesForm";
import { getSession, hasPermission } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata = {
  title: "Paramétrage des horaires - Portail SIM Assurances",
};

export default async function ParametrageHorairesPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, "pointage.gerer_parametrage")) {
    redirect("/?error=acces_refuse");
  }

  const config = await prisma.parametrageHoraire.findFirst({
    where: { isActive: true },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Paramétrage des horaires"
        description="Définissez les horaires de référence par défaut pour le pointage des collaborateurs."
      />
      <HorairesForm config={config} />
    </div>
  );
}

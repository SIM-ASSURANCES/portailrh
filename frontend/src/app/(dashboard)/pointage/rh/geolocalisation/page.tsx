import { prisma } from "backend";
import { PageHeader } from "@/components/ui";
import { GeolocalisationForm } from "./GeolocalisationForm";
import { getSession, hasPermission } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata = {
  title: "Géolocalisation - Portail SIM Assurances",
};

export default async function GeolocalisationPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, "pointage.gerer_horaires")) {
    redirect("/?error=acces_refuse");
  }

  const config = await prisma.parametrageHoraire.findFirst({
    where: { isActive: true },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Géolocalisation du pointage"
        description="Configurez le pointage hors réseau par GPS. Définissez les coordonnées du bureau et le rayon de proximité autorisé."
        backHref="/pointage/rh"
        backLabel="Retour à la Boîte à Outils"
      />
      <GeolocalisationForm config={config} />
    </div>
  );
}

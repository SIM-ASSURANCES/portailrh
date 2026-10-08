import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { demandesServiceAValiderWhere, prisma, resumeMotifDemande } from "backend";

import { DemandesServiceTable } from "./DemandesServiceTable";

/**
 * « Demandes de mon service à valider » (circuit de validation, commit 4) : les demandes à l'étape Service dont le
 * compte connecté est le responsable ACTUEL du service du demandeur — jamais celles d'un autre service. Réservée à
 * un responsable d'au moins un service (aucune permission requise : c'est `Service.responsableId` qui désigne le
 * décideur). Les plus anciennes en premier.
 */
export default async function DemandesServicePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const services = await prisma.service.findMany({
    where: { responsableId: session.user.id },
    orderBy: { name: "asc" },
    select: { name: true },
  });
  if (services.length === 0) redirect("/?error=acces_refuse_service");

  const demandes = await prisma.demande.findMany({
    where: demandesServiceAValiderWhere(session.user.id),
    include: {
      createur: { select: { fullName: true, service: { select: { name: true } } } },
      lignes: { select: { libelle: true, motif: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Demandes de mon service à valider"
        description={`Responsable ${services.length > 1 ? "des services" : "du service"} ${services
          .map((s) => `« ${s.name} »`)
          .join(", ")}. Les plus anciennes en premier.`}
      />
      <DemandesServiceTable
        demandes={demandes.map((d) => ({
          id: d.id,
          reference: d.reference,
          demandeur: d.createur.fullName,
          service: d.createur.service?.name ?? "—",
          montant: Number(d.montant),
          motif: resumeMotifDemande(d.description, d.lignes),
          createdAt: d.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}

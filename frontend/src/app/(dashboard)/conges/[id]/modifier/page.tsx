import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { aujourdhui } from "@/lib/conges/format";
import { jourCivilDepuisColonneDate, prisma } from "backend";

import { DemandeCongeForm } from "../../DemandeCongeForm";

export default async function ModifierDemandeCongePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "conges.soumettre")) {
    const estResponsable = await prisma.service.count({ where: { responsableId: session.user.id } });
    redirect(estResponsable > 0 ? "/conges/a-decider" : "/?error=acces_refuse_conges");
  }

  const demande = await prisma.demandeConge.findUnique({ where: { id } });
  if (!demande || demande.userId !== session.user.id) notFound();
  if (demande.statut !== "MODIFICATION_DEMANDEE") redirect(`/conges/${id}`);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Modifier la demande ${demande.reference}`}
        description={`Modification demandée : ${demande.motifModification ?? "Veuillez corriger les informations de la demande."}`}
      />
      <DemandeCongeForm
        aujourdhui={aujourdhui()}
        demandeId={demande.id}
        initial={{
          nature: demande.nature,
          motif: demande.motif,
          dateDebut: jourCivilDepuisColonneDate(demande.dateDebut),
          dateFin: jourCivilDepuisColonneDate(demande.dateFin),
        }}
      />
    </div>
  );
}

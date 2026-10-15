import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { aujourdhui } from "@/lib/conges/format";
import { jourCivilDepuisColonneDate, prisma } from "backend";

import { DemandeCongeForm } from "../../DemandeCongeForm";

/** Correction d'une demande dont la RH a demandé la modification : réservée au demandeur, statut MODIFICATION_DEMANDEE. */
export default async function ModifierDemandeCongePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "conges.soumettre")) redirect("/?error=acces_refuse_conges");

  const demande = await prisma.demandeConge.findUnique({ where: { id }, include: { piecesJointes: true } });
  if (!demande || demande.userId !== session.user.id) notFound();
  if (demande.statut !== "MODIFICATION_DEMANDEE") redirect(`/conges/${id}`);

  const types = await prisma.typeConge.findMany({ where: { isActive: true }, orderBy: [{ categorie: "asc" }, { label: "asc" }] });

  return (
    <div className="space-y-6">
      <PageHeader title={`Modifier la demande ${demande.reference}`} description={demande.motifModification ? `Modification demandée : ${demande.motifModification}` : undefined} />
      <DemandeCongeForm
        mode="modifier"
        demandeId={demande.id}
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
        initial={{
          typeCongeId: demande.typeCongeId,
          dateDebut: jourCivilDepuisColonneDate(demande.dateDebut),
          dateFin: jourCivilDepuisColonneDate(demande.dateFin),
          motif: demande.motif,
          interimaire: demande.interimaire ?? "",
          // Les pièces déjà déposées sont reprises ; la resoumission les remplace par la liste envoyée.
          pieces: demande.piecesJointes.map((p) => ({ url: p.url, nomFichier: p.nomFichier ?? p.url })),
        }}
      />
    </div>
  );
}

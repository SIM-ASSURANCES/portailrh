import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { VARIANTE_STATUT_CONGE } from "@/components/conges/statutConge";
import { getSession, hasPermission } from "@/lib/auth";
import { frDate, libelleJours } from "@/lib/conges/format";
import { listerMesConges } from "@/lib/conges/lecture";
import { LIBELLE_NATURE_CONGE, LIBELLE_STATUT_CONGE, prisma } from "backend";

export default async function MesCongesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "conges.soumettre")) {
    const estResponsable = (await prisma.service.count({ where: { responsableId: session.user.id } })) > 0;
    redirect(estResponsable ? "/conges/a-decider" : "/");
  }

  const demandes = await listerMesConges(session.user.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mes congés"
        description="Suivez vos demandes de congé et leur validation."
        actions={
          <Link href="/conges/nouvelle">
            <Button variant="primary">Nouvelle demande</Button>
          </Link>
        }
      />

      {demandes.length === 0 ? (
        <EmptyState icon="calendar" message="Vous n’avez encore déposé aucune demande de congé." />
      ) : (
        <ul className="space-y-3">
          {demandes.map((demande) => (
            <li key={demande.id}>
              <Link href={`/conges/${demande.id}`} className="block">
                <Card className="card-shadow-hover space-y-2 p-4 transition-transform motion-safe:hover:-translate-y-0.5 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-foreground">{LIBELLE_NATURE_CONGE[demande.nature]}</p>
                      <p className="text-xs text-muted-foreground">{demande.reference}</p>
                    </div>
                    <Badge variant={VARIANTE_STATUT_CONGE[demande.statut]}>
                      {LIBELLE_STATUT_CONGE[demande.statut]}
                    </Badge>
                  </div>
                  <p className="text-sm text-foreground">
                    Du {frDate(demande.dateDebut)} au {frDate(demande.dateFin)} · {libelleJours(demande.nbJoursOuvres)}
                  </p>
                  {demande.statut === "MODIFICATION_DEMANDEE" && demande.motifModification ? (
                    <p className="text-sm font-medium text-info">
                      Modification demandée : {demande.motifModification}
                    </p>
                  ) : null}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

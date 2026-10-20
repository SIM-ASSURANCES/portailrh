import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { VARIANTE_STATUT_CONGE } from "@/components/conges/statutConge";
import { getSession } from "@/lib/auth";
import { frDate, frDateInstant, libelleJours } from "@/lib/conges/format";
import { chargerFileDecisionConges } from "@/lib/conges/lecture";
import {
  LIBELLE_NATURE_CONGE,
  LIBELLE_STATUT_CONGE,
  PERMISSION_DG_CONGE,
  PERMISSION_ETAPE_RH_CONGE,
  prisma,
} from "backend";

export default async function CongesADeciderPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const peutDeciderParRole =
    session.rolePermissions.includes(PERMISSION_ETAPE_RH_CONGE) ||
    session.rolePermissions.includes(PERMISSION_DG_CONGE);
  const estResponsable = await prisma.service.count({ where: { responsableId: session.user.id } });
  if (!peutDeciderParRole && estResponsable === 0) redirect("/?error=acces_refuse_conges");

  const file = await chargerFileDecisionConges(session);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Congés à décider"
        description="Demandes qui attendent votre décision, des plus anciennes aux plus récentes."
      />
      {file.length === 0 ? (
        <EmptyState icon="check-circle" message="Aucune demande à décider : vous êtes à jour." />
      ) : (
        <ul className="space-y-3">
          {file.map((demande) => (
            <li key={demande.id}>
              <Link href={`/conges/${demande.id}`} className="block">
                <Card className="card-shadow-hover space-y-2 p-4 transition-transform motion-safe:hover:-translate-y-0.5 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-foreground">{demande.demandeurNom}</p>
                      <p className="text-xs text-muted-foreground">
                        {demande.serviceNom ?? "Aucun service"} · {demande.reference}
                      </p>
                    </div>
                    <Badge variant={VARIANTE_STATUT_CONGE[demande.statut]}>
                      {LIBELLE_STATUT_CONGE[demande.statut]}
                    </Badge>
                  </div>
                  <p className="text-sm text-foreground">
                    {LIBELLE_NATURE_CONGE[demande.nature]} · du {frDate(demande.dateDebut)} au{" "}
                    {frDate(demande.dateFin)} · {libelleJours(demande.nbJoursOuvres)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    En attente depuis le {frDateInstant(demande.etapeDepuis)}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

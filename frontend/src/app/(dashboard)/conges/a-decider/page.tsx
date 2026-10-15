import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { VARIANTE_STATUT_ABSENCE } from "@/components/conges/statutAbsence";
import { getSession } from "@/lib/auth";
import { frDateColonne, frDateInstant, libelleJours } from "@/lib/conges/format";
import { chargerFileDecisionConges } from "@/lib/conges/lecture";
import { LIBELLE_STATUT_ABSENCE } from "backend";

/** Demandes que CE compte peut décider maintenant (le moteur du circuit tranche, jamais la page). Les plus anciennes d'abord. */
export default async function CongesADeciderPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const file = await chargerFileDecisionConges(session);

  return (
    <div className="space-y-6">
      <PageHeader title="Congés à décider" description="Demandes de congé qui attendent votre décision, les plus anciennes en premier." />
      {file.length === 0 ? (
        <EmptyState icon="check-circle" message="Aucune demande à décider : vous êtes à jour." />
      ) : (
        <ul className="space-y-3">
          {file.map((d) => (
            <li key={d.id}>
              <Link href={`/conges/${d.id}`} className="block">
                <Card className="card-shadow-hover space-y-2 p-4 transition-transform motion-safe:hover:-translate-y-0.5 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-foreground">{d.demandeurNom}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.serviceNom ?? "Aucun service"} · {d.reference}
                      </p>
                    </div>
                    <Badge variant={VARIANTE_STATUT_ABSENCE[d.statut]}>{LIBELLE_STATUT_ABSENCE[d.statut]}</Badge>
                  </div>
                  <p className="text-sm text-foreground">
                    {d.libelleType} · du {frDateColonne(d.dateDebut)} au {frDateColonne(d.dateFin)} · {libelleJours(d.nbJours)}
                  </p>
                  <p className="text-xs text-muted-foreground">En attente depuis le {frDateInstant(d.etapeDepuis)}</p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

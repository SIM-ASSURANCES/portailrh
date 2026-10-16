import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { VARIANTE_STATUT_ABSENCE } from "@/components/conges/statutAbsence";
import { getSession, hasPermission } from "@/lib/auth";
import { frDateColonne } from "@/lib/conges/format";
import { formatMinutesEnHeures, LIBELLE_STATUT_ABSENCE, PERMISSION_DG_ABSENCE, prisma, type StatutCircuitAbsence } from "backend";

/** Mes permissions d'absence : compteurs du mois par type, puis mes demandes (cartes, jamais de tableau qui déborde). */
export default async function MesPermissionsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "absences.soumettre")) {
    const estResponsable = (await prisma.service.count({ where: { responsableId: session.user.id } })) > 0;
    redirect(
      session.rolePermissions.includes("absences.valider_rh") || estResponsable
        ? "/permissions-absence/a-decider"
        : session.rolePermissions.includes(PERMISSION_DG_ABSENCE)
          ? "/permissions-absence/toutes"
          : "/"
    );
  }

  const maintenant = new Date();
  const debutMois = new Date(Date.UTC(maintenant.getFullYear(), maintenant.getMonth(), 1));
  const finMois = new Date(Date.UTC(maintenant.getFullYear(), maintenant.getMonth() + 1, 0));

  const [types, duMois, demandes] = await Promise.all([
    prisma.typePermission.findMany({ where: { isActive: true }, orderBy: { label: "asc" } }),
    prisma.demandePermission.findMany({
      where: { userId: session.user.id, date: { gte: debutMois, lte: finMois }, statut: { in: ["EN_ATTENTE_RESPONSABLE", "EN_ATTENTE_RH", "APPROUVEE", "CONSOMMEE"] } },
      select: { typePermissionId: true },
    }),
    prisma.demandePermission.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { typePermission: { select: { label: true } } },
    }),
  ]);
  const utilises = new Map<string, number>();
  for (const d of duMois) utilises.set(d.typePermissionId, (utilises.get(d.typePermissionId) ?? 0) + 1);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mes permissions d'absence"
        description="Absences de quelques heures sur une journée de travail. Votre responsable examine d'abord la demande, puis la RH l'approuve."
        actions={
          <Link href="/permissions-absence/nouvelle">
            <Button variant="primary">Nouvelle demande</Button>
          </Link>
        }
      />

      <section aria-label="Compteurs du mois" className="space-y-3">
        <h2 className="text-base font-bold text-foreground">Ce mois-ci</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {types.map((t) => {
            const utilise = utilises.get(t.id) ?? 0;
            return (
              <li key={t.id}>
                <Card className="space-y-1 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.label}</p>
                  <p className="text-2xl font-black tabular-nums text-foreground">
                    {utilise}
                    <span className="text-base font-bold text-muted-foreground"> / {t.plafondMensuel}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{t.dureeMaxHeures} h au plus par permission</p>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="Mes demandes" className="space-y-3">
        <h2 className="text-base font-bold text-foreground">Mes demandes</h2>
        {demandes.length === 0 ? (
          <EmptyState icon="clock" message="Vous n'avez encore déposé aucune demande de permission." />
        ) : (
          <ul className="space-y-3">
            {demandes.map((d) => {
              const statut = d.statut as StatutCircuitAbsence;
              return (
                <li key={d.id}>
                  <Link href={`/permissions-absence/${d.id}`} className="block">
                    <Card className="card-shadow-hover space-y-2 p-4 transition-transform motion-safe:hover:-translate-y-0.5 sm:p-5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-bold text-foreground">{d.typePermission.label}</p>
                          <p className="text-xs text-muted-foreground">{d.reference}</p>
                        </div>
                        <Badge variant={VARIANTE_STATUT_ABSENCE[statut]}>{LIBELLE_STATUT_ABSENCE[statut]}</Badge>
                      </div>
                      <p className="text-sm text-foreground">
                        Le {frDateColonne(d.date)} de {d.heureDepart} à {d.heureRetourPrevue} · {formatMinutesEnHeures(d.dureeMinutes)}
                      </p>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

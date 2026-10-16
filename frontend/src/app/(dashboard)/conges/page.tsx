import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { VARIANTE_STATUT_ABSENCE } from "@/components/conges/statutAbsence";
import { getSession, hasPermission } from "@/lib/auth";
import { aujourdhui, frDateColonne, libelleJours } from "@/lib/conges/format";
import {
  calculerExercice,
  jourCivilDepuisColonneDate,
  LIBELLE_STATUT_ABSENCE,
  MESSAGE_DATE_EMBAUCHE_MANQUANTE,
  prisma,
  type StatutCircuitAbsence,
} from "backend";

/** Mes congés : solde de l'exercice en cours, puis mes demandes (cartes, jamais de tableau qui déborde sur mobile). */
export default async function MesCongesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "conges.soumettre")) {
    const estResponsable = (await prisma.service.count({ where: { responsableId: session.user.id } })) > 0;
    redirect(session.rolePermissions.includes("conges.valider_rh") || estResponsable ? "/conges/a-decider" : "/");
  }

  const [user, demandes, soldes] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id }, select: { dateEmbauche: true } }),
    prisma.demandeConge.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { typeConge: { select: { label: true } } },
    }),
    prisma.soldeConge.findMany({ where: { userId: session.user.id }, include: { typeConge: { select: { label: true } } }, orderBy: [{ exercice: "desc" }] }),
  ]);

  const dateEmbauche = user?.dateEmbauche ? jourCivilDepuisColonneDate(user.dateEmbauche) : null;
  const exerciceCourant = dateEmbauche ? calculerExercice(dateEmbauche, aujourdhui()) : null;
  const soldesCourants = exerciceCourant ? soldes.filter((s) => s.exercice === exerciceCourant.exercice) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mes congés"
        description="Vos demandes de congé et votre solde de l'exercice en cours."
        actions={
          <Link href="/conges/nouvelle">
            <Button variant="primary">Nouvelle demande</Button>
          </Link>
        }
      />

      <section aria-label="Solde" className="space-y-3">
        {!dateEmbauche ? (
          <p className="rounded-lg border border-warning-border bg-warning-bg px-4 py-3 text-sm text-warning">{MESSAGE_DATE_EMBAUCHE_MANQUANTE}</p>
        ) : soldesCourants.length === 0 ? (
          <Card className="p-5">
            <p className="text-sm text-muted-foreground">
              Aucun solde ouvert pour l&apos;exercice {exerciceCourant?.exercice} : il sera créé avec la dotation du type à votre première demande validée.
            </p>
          </Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {soldesCourants.map((s) => (
              <li key={s.id}>
                <Card className="space-y-1 p-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.typeConge.label}</p>
                  <p className="text-3xl font-black tabular-nums text-foreground">
                    {s.soldeRestant}
                    <span className="text-base font-bold text-muted-foreground"> / {s.soldeInitial} jours</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Exercice du {frDateColonne(s.dateDebutExercice)} au {frDateColonne(s.dateFinExercice)}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Mes demandes" className="space-y-3">
        <h2 className="text-base font-bold text-foreground">Mes demandes</h2>
        {demandes.length === 0 ? (
          <EmptyState icon="calendar" message="Vous n'avez encore déposé aucune demande de congé." />
        ) : (
          <ul className="space-y-3">
            {demandes.map((d) => {
              const statut = d.statut as StatutCircuitAbsence;
              return (
                <li key={d.id}>
                  <Link href={`/conges/${d.id}`} className="block">
                    <Card className="card-shadow-hover space-y-2 p-4 transition-transform motion-safe:hover:-translate-y-0.5 sm:p-5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-bold text-foreground">{d.typeConge.label}</p>
                          <p className="text-xs text-muted-foreground">{d.reference}</p>
                        </div>
                        <Badge variant={VARIANTE_STATUT_ABSENCE[statut]}>{LIBELLE_STATUT_ABSENCE[statut]}</Badge>
                      </div>
                      <p className="text-sm text-foreground">
                        Du {frDateColonne(d.dateDebut)} au {frDateColonne(d.dateFin)} · {libelleJours(d.nbJours)}
                      </p>
                      {statut === "MODIFICATION_DEMANDEE" ? <p className="text-sm font-medium text-info">Une modification vous est demandée : ouvrez la demande.</p> : null}
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

import { redirect } from "next/navigation";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader, StatCard } from "@/components/ui";
import { HistoriqueFilters } from "./HistoriqueFilters";

import { Icon } from "@/components/icons";
import { AbsencesTable, PointagesTable, type AbsenceRow, type PointageRow } from "./HistoriqueTables";

interface HistoriquePageProps {
  searchParams: Promise<{
    du?: string;
    au?: string;
    type?: string;
  }>;
}

export default async function PointageHistoriquePage({ searchParams }: HistoriquePageProps) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { du, au, type } = await searchParams;

  // Construction des bornes de dates
  let dateDebut: Date | undefined = undefined;
  let dateFin: Date | undefined = undefined;

  if (du) {
    const d = new Date(du);
    d.setHours(0, 0, 0, 0);
    dateDebut = d;
  }

  if (au) {
    const d = new Date(au);
    d.setHours(23, 59, 59, 999);
    dateFin = d;
  }

  // Filtre Prisma pour les Pointages
  const pointageWhere: Record<string, unknown> = {
    userId: session.user.id,
  };

  if (dateDebut || dateFin) {
    pointageWhere.heure = {
      ...(dateDebut ? { gte: dateDebut } : {}),
      ...(dateFin ? { lte: dateFin } : {}),
    };
  }

  if (type === "ARRIVEE") {
    pointageWhere.type = "ARRIVEE";
  } else if (type === "DEPART") {
    pointageWhere.type = "DEPART";
  } else if (type === "RETARD") {
    pointageWhere.estRetard = true;
  }

  // Filtre Prisma pour les Absences
  const absenceWhere: Record<string, unknown> = {
    userId: session.user.id,
  };

  if (dateDebut || dateFin) {
    absenceWhere.date = {
      ...(dateDebut ? { gte: dateDebut } : {}),
      ...(dateFin ? { lte: dateFin } : {}),
    };
  }

  const showPointages = type !== "ABSENCE";
  const showAbsences = type === "ALL" || type === "ABSENCE" || !type;

  // Récupération concurrente des données
  const [pointagesDb, absencesDb, allUserPointagesForStats, allUserAbsencesForStats] = await Promise.all([
    showPointages
      ? prisma.pointage.findMany({
        where: pointageWhere,
        orderBy: { heure: "desc" },
        include: {
          effectuePar: { select: { fullName: true } },
          corrections: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      })
      : Promise.resolve([]),
    showAbsences
      ? prisma.absence.findMany({
        where: absenceWhere,
        orderBy: { date: "desc" },
        include: {
          controlePar: { select: { fullName: true } },
        },
      })
      : Promise.resolve([]),
    // Calcul des statistiques globales sur la période filtrée (sans filtre de type)
    prisma.pointage.findMany({
      where: {
        userId: session.user.id,
        ...(dateDebut || dateFin
          ? {
            heure: {
              ...(dateDebut ? { gte: dateDebut } : {}),
              ...(dateFin ? { lte: dateFin } : {}),
            },
          }
          : {}),
      },
      select: {
        type: true,
        estRetard: true,
        minutesRetard: true,
        heure: true,
      },
    }),
    prisma.absence.findMany({
      where: {
        userId: session.user.id,
        ...(dateDebut || dateFin
          ? {
            date: {
              ...(dateDebut ? { gte: dateDebut } : {}),
              ...(dateFin ? { lte: dateFin } : {}),
            },
          }
          : {}),
      },
      select: {
        statut: true,
      },
    }),
  ]);

  // Formatage sérialisable des lignes de pointage
  const pointages: PointageRow[] = pointagesDb.map((p) => ({
    id: p.id,
    heure: p.heure.toISOString(),
    type: p.type,
    source: p.source,
    estRetard: p.estRetard,
    minutesRetard: p.minutesRetard,
    motif: p.motif,
    effectueParNom: p.effectuePar?.fullName ?? null,
    correctionsCount: p.corrections.length,
    dernierMotifCorrection: p.corrections[0]?.motif ?? null,
  }));

  // Formatage sérialisable des lignes d'absence
  const absences: AbsenceRow[] = absencesDb.map((a) => ({
    id: a.id,
    date: a.date.toISOString(),
    statut: a.statut,
    motif: a.motif,
    controleParNom: a.controlePar?.fullName ?? null,
  }));

  // Statistiques
  const totalArrivees = allUserPointagesForStats.filter((p) => p.type === "ARRIVEE").length;
  const totalDeparts = allUserPointagesForStats.filter((p) => p.type === "DEPART").length;
  const retardsList = allUserPointagesForStats.filter((p) => p.estRetard);
  const nombreJoursRetard = retardsList.length;
  const totalMinutesRetard = retardsList.reduce((acc, p) => acc + (p.minutesRetard || 0), 0);
  const totalAbsences = allUserAbsencesForStats.length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 font-sans">
      <PageHeader
        title="Mon Historique de Pointage"
        description="Consultez l'ensemble de vos pointages d'arrivée, de départ, vos retards et vos absences."
      />

      {/* Cartes d'indicateurs / KPI */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon="clock"
          tone="info"
          label="Total arrivées"
          value={totalArrivees}
          hint={`${totalDeparts} départ(s) enregistré(s)`}
        />
        <StatCard
          icon="alert-triangle"
          tone={nombreJoursRetard > 0 ? "warning" : "success"}
          label="Jours de retard"
          value={nombreJoursRetard}
          hint={nombreJoursRetard > 0 ? `${totalMinutesRetard} min de retard au total` : "Aucun retard sur la période"}
        />
        <StatCard
          icon="calendar"
          tone="warning"
          label="Minutes de retard"
          value={`${totalMinutesRetard} min`}
          hint="Cumul du temps de retard"
        />
        <StatCard
          icon="inbox"
          tone={totalAbsences > 0 ? "danger" : "neutral"}
          label="Absences signalées"
          value={totalAbsences}
          hint="Sur la période sélectionnée"
        />
      </div>

      {/* Barre de filtres par période et type */}
      <HistoriqueFilters
        initial={{
          du,
          au,
          type,
        }}
      />

      {/* Tableau des Pointages */}
      {showPointages ? (
        <div className="space-y-3 rounded-2xl border border-border bg-surface p-4 sm:p-6 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon name="clock" className="size-5 text-primary" />
              <h2 className="text-base font-bold text-foreground">
                Pointages ({pointages.length})
              </h2>
            </div>
            {pointages.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                Trié par date décroissante
              </span>
            ) : null}
          </div>

          <PointagesTable pointages={pointages} />
        </div>
      ) : null}

      {/* Tableau des Absences */}
      {showAbsences ? (
        <div className="space-y-3 rounded-2xl border border-border bg-surface p-4 sm:p-6 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon name="alert-triangle" className="size-5 text-warning" />
              <h2 className="text-base font-bold text-foreground">
                Absences ({absences.length})
              </h2>
            </div>
            {absences.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                Signalements d&apos;absence
              </span>
            ) : null}
          </div>

          <AbsencesTable absences={absences} />
        </div>
      ) : null}
    </div>
  );
}
